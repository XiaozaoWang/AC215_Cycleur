import io
import json
from types import SimpleNamespace
from unittest.mock import Mock

import pandas as pd
import pytest
from google.api_core.exceptions import NotFound
from google.iam.v1.policy_pb2 import Policy

import cli


@pytest.fixture
def baseline_check(monkeypatch):
    check = Mock()
    monkeypatch.setattr(cli, "check_baseline_model", check)
    return check


def live_lookup(model_max=3, model_concurrency=8, missing=None):
    # Fake Cloud Run lookups: upstream URLs, and how many calls the live model-service takes at once (for the API budget check)
    def lookup(*, name):
        if missing and name.endswith("/" + missing):
            raise NotFound("new service")
        if name.endswith("/greenpath-model-service"):
            return SimpleNamespace(uri="https://model.run.app", template=SimpleNamespace(
                scaling=SimpleNamespace(max_instance_count=model_max), max_instance_request_concurrency=model_concurrency))
        if name.endswith("/greenpath-rag-service"):
            return SimpleNamespace(uri="https://rag.run.app")
        return SimpleNamespace(uri="https://api.run.app")
    return lookup


def policy():
    return Policy(version=3, etag=b"etag", bindings=[
        {"role": "roles/run.invoker", "members": ["allUsers", "allAuthenticatedUsers", "user:owner@example.com"]},
        {"role": "roles/viewer", "members": ["user:reader@example.com"]},
        {"role": "roles/run.invoker", "members": ["user:conditional@example.com"],
         "condition": {"expression": "request.time < timestamp('2030-01-01T00:00:00Z')"}},
    ])


@pytest.mark.parametrize("service,new", [("model", True), ("model", False), ("api", False), ("frontend", False)])
def test_deploy_settings_and_access(monkeypatch, service, new, baseline_check):
    client = Mock()
    client.get_service.side_effect = live_lookup(missing=cli.SERVICES[service]["name"] if new else None)
    client.create_service.return_value.result.return_value = SimpleNamespace(uri="https://new.run.app")
    client.update_service.return_value.result.return_value = SimpleNamespace(uri="https://new.run.app")
    client.get_iam_policy.return_value = policy()
    monkeypatch.setattr(cli.run_v2, "ServicesClient", Mock(return_value=client))
    cli.deploy(service, tag="test")
    assert baseline_check.call_count == int(service in ("api", "model"))

    call = client.create_service.call_args if new else client.update_service.call_args
    config, s = call.kwargs["service"], cli.SERVICES[service]
    template, container = config.template, config.template.containers[0]
    assert config.name == ("" if new else cli.full_name(service))
    if new:   # the model is created in its own region (us-east4, where the L4 quota is)
        assert call.kwargs["parent"].endswith("/locations/" + ("us-east4" if service == "model" else cli.GCP_REGION))
    assert template.service_account == f"{s['name']}@{cli.GCP_PROJECT}.iam.gserviceaccount.com"
    assert template.revision.startswith(s["name"] + "-")
    assert container.image.endswith(f"/greenpath/{s['name']}:test")
    # the numbers that must not get mixed up between services
    expected = {"model": (3, 8, "8", "32Gi"), "api": (1, 20, "2", "2Gi"), "frontend": (3, 20, "1", "512Mi")}[service]
    assert (template.scaling.max_instance_count, template.max_instance_request_concurrency,
            container.resources.limits["cpu"], container.resources.limits["memory"]) == expected
    assert config.scaling.max_instance_count == expected[0]
    assert container.resources.startup_cpu_boost
    # only the model has a GPU; with a GPU Cloud Run requires instance-based billing (cpu_idle off)
    gpu = service == "model"
    assert (container.resources.limits.get("nvidia.com/gpu"), template.node_selector.accelerator) == (("1", "nvidia-l4") if gpu else (None, ""))
    assert template.gpu_zonal_redundancy_disabled == gpu and container.resources.cpu_idle == (not gpu)
    assert container.ports[0].container_port == 8080
    assert not config.invoker_iam_disabled and config.traffic[0].percent == 100
    if not new:
        assert {"invoker_iam_disabled", "scaling", "template"} <= set(call.kwargs["update_mask"].paths)

    env = {v.name: v.value for v in container.env}
    assert "GOOGLE_APPLICATION_CREDENTIALS" not in env
    if service == "model":
        assert env == {"GREENPATH_BUCKET": cli.BUCKET, "DATASETS": "1026_Full_data", "TORCH_THREADS": "8"}
    elif service == "api":
        assert env["MODEL_MAX_CONCURRENCY"] == "24" and env["MODEL_SERVICE_URL"] == "https://model.run.app"
        assert env["RAG_SERVICE_URL"] == "https://rag.run.app" and env["LLM_PROVIDER"] == "gemini"
    else:
        assert env == {"API_SERVICE_URL": "https://api.run.app"}

    # who may call it: frontend public, api only the frontend, model only the api; other bindings untouched
    access = client.set_iam_policy.call_args.kwargs["request"]
    assert access["resource"] == cli.full_name(service) and access["policy"].etag == b"etag"
    members = [m for b in access["policy"].bindings if b.role == "roles/run.invoker" for m in b.members]
    caller = {"model": "greenpath-api-service", "api": "greenpath-frontend"}.get(service)
    assert ("allUsers" in members) == (service == "frontend")
    assert "allAuthenticatedUsers" not in members and "user:conditional@example.com" in members
    assert any(b.role == "roles/viewer" for b in access["policy"].bindings)
    if caller:
        assert f"serviceAccount:{caller}@{cli.GCP_PROJECT}.iam.gserviceaccount.com" in members


def test_api_budget_must_fit_model_instances(monkeypatch, baseline_check):
    # the live model-service takes 3 instances x 8 requests = 24, the API wants 30 calls at once: refuse before touching anything
    client = Mock()
    client.get_service.side_effect = live_lookup()
    monkeypatch.setattr(cli.run_v2, "ServicesClient", Mock(return_value=client))
    with pytest.raises(SystemExit, match="Deploy the model first"):
        cli.deploy("api", model_concurrency=30)
    client.update_service.assert_not_called()
    client.create_service.assert_not_called()
    # the old CPU model-service (30 instances x 1 request each) takes 30
    client.get_service.side_effect = live_lookup(model_max=30, model_concurrency=1)
    client.update_service.return_value.result.return_value = SimpleNamespace(uri="https://new.run.app")
    client.get_iam_policy.return_value = policy()
    cli.deploy("api", model_concurrency=30)
    env = {v.name: v.value for v in client.update_service.call_args.kwargs["service"].template.containers[0].env}
    assert env["MODEL_MAX_CONCURRENCY"] == "30"


def test_model_parity_test_passes_and_fails(monkeypatch, baseline_check):
    targets = ["tree_canopy", "water_access"]
    cells = [f"area_8a2a{i:011x}" for i in range(60)]
    expected = pd.DataFrame({"cell_id": cells, "tree_canopy": 0.5, "water_access": 0.25})
    buf = io.BytesIO(); expected.to_parquet(buf)
    fs = Mock(); fs.cat.return_value = buf.getvalue()
    monkeypatch.setattr(cli.requests, "get", Mock(return_value=Mock(json=Mock(return_value={
        "run_id": "r", "training_id": "t", "targets": targets, "cells": 60}))))
    def answer(offset):
        def post(url, json, headers, timeout):
            rows = [{"h3_index": h, "status": "ok", "scores": {"tree_canopy": 0.5 + offset, "water_access": 0.25}} for h in json["h3_indices"]]
            return Mock(json=Mock(return_value={"results": rows}))
        return post
    monkeypatch.setattr(cli.requests, "post", answer(0.002))
    cli.test_model(fs, local=True)                     # within tolerance
    monkeypatch.setattr(cli.requests, "post", answer(0.05))
    with pytest.raises(SystemExit):
        cli.test_model(fs, local=True)                 # off by 0.05


@pytest.mark.parametrize("full", [False, True])
def test_local_smoke_keeps_expensive_scoring_optional(monkeypatch, full, baseline_check):
    monkeypatch.setattr(cli.run_v2, "ServicesClient", Mock(side_effect=AssertionError("local test must not contact Cloud Run")))
    response = Mock()
    response.json.return_value = {"h3_index": ["a"]}
    monkeypatch.setattr(cli.requests, "get", Mock(return_value=response))
    score = Mock()
    score.json.return_value = {"cells": [{"h3_index": "a", "value": 0}], "weights": dict.fromkeys(range(15), 0),
                              "agent": {"used_fallback": False}, "timings_ms": {}}
    post = Mock(return_value=score)
    monkeypatch.setattr(cli.requests, "post", post)
    cli.test_app("frontend", local=True, full=full)
    assert post.call_count == int(full)


def test_private_api_smoke_uses_id_token(monkeypatch, baseline_check):
    client = Mock()
    client.get_service.return_value.uri = "https://api.run.app"
    monkeypatch.setattr(cli.run_v2, "ServicesClient", Mock(return_value=client))
    token = Mock(return_value="test-token")
    monkeypatch.setattr(cli, "id_token", token)
    region = Mock()
    region.json.return_value = {"h3_index": ["a"]}
    get = Mock(side_effect=[Mock(status_code=403), Mock(), region])
    monkeypatch.setattr(cli.requests, "get", get)
    cli.test_app("api")
    token.assert_called_once_with("https://api.run.app")
    assert get.call_args.kwargs["headers"] == {"Authorization": "Bearer test-token"}


@pytest.mark.parametrize("run_id,training_id,valid", [(cli.RUN_ID, cli.TRAINING_ID, True),
    ("different-model", cli.TRAINING_ID, False), (cli.RUN_ID, "different-training-set", False)])
def test_baseline_model_versions(monkeypatch, tmp_path, run_id, training_id, valid):
    manifest = tmp_path / "manifest.json"
    manifest.write_text(json.dumps({"model_run_id": cli.RUN_ID, "training_id": cli.TRAINING_ID}))
    monkeypatch.setattr(cli, "BASELINE_MANIFEST", manifest)
    monkeypatch.setattr(cli, "service_url", Mock(return_value=("http://model", {})))
    get = Mock(return_value=Mock(json=Mock(return_value={"run_id": run_id, "training_id": training_id})))
    monkeypatch.setattr(cli.requests, "get", get)
    if valid:
        cli.check_baseline_model(local=True)
    else:
        with pytest.raises(RuntimeError, match="baseline/model version mismatch"):
            cli.check_baseline_model(local=True)
    get.assert_called_once_with("http://model/health", headers={}, timeout=300)


def test_missing_baseline_manifest_fails_before_network(monkeypatch, tmp_path):
    monkeypatch.setattr(cli, "BASELINE_MANIFEST", tmp_path / "missing.json")
    get = Mock()
    monkeypatch.setattr(cli.requests, "get", get)
    with pytest.raises(RuntimeError, match="Cannot read routing baseline manifest"):
        cli.check_baseline_model()
    get.assert_not_called()


def test_api_version_mismatch_prevents_deployment(monkeypatch):
    client = Mock()
    monkeypatch.setattr(cli.run_v2, "ServicesClient", Mock(return_value=client))
    monkeypatch.setattr(cli, "check_baseline_model", Mock(side_effect=RuntimeError("baseline/model version mismatch")))
    with pytest.raises(RuntimeError, match="version mismatch"):
        cli.deploy("api")
    client.update_service.assert_not_called()
    client.create_service.assert_not_called()
