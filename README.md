# Cycleur · Milestone 4

What is still to do, then what changed in this milestone. The full previous README is in the git history
(`git show a98148d:README.md`).

## Still to do

**Routing and the agent**

- [ ] Use speed limits, street lights, turn restrictions and traffic signals: some of it in routing itself, all of it
      recorded for the agent
- [ ] Agent architecture: its own service, or part of api-service; decide which routing information is useful to send to the LLM
- [ ] Manage conversation history, routes and the satellite-tile bucket
- [ ] A place-name (geocoding) API, so the start and the destination can be typed
- [ ] Revisit how the routing search area is divided: should it be smaller? Could we sample every other cell to be
      faster and plan longer routes?
- [ ] Read through, clean up and consolidate the code
- [ ] Sunset and weather APIs
- [ ] Fine-tune a new "Expert" language style

**Frontend**

- [ ] How the two inputs (the agent and route planning) work together
- [ ] Sign-in and account management

**Backend and deployment**

- [ ] Automated CI/CD
- [ ] Monitoring for the model and the other services
- [ ] W&B logging for model training

**Later, smaller ideas**

- [ ] Click a point on a route to see Street View
- [ ] Sign in with Google (in progress)
- [ ] Image + text (multimodal) input
- [ ] Small local adjustments to a chosen route
- [ ] Routing through several waypoints
- [ ] Use the user's real location
- [ ] Open a planned route in Google Maps navigation
- [ ] Voice input and a voice assistant (Wang's suggestion)

## What changed in this milestone

1. [RAG service](#1-rag-service) was reorganized
2. [Kubernetes on GKE](#2-kubernetes-on-gke) is a new way to deploy the whole app
3. [Cloud Run vs GKE](#3-cloud-run-vs-gke): the two deployments side by side

## 1. RAG service

`src/rag-service/` was refactored (same behaviour, cleaner layout):

| Before | Now |
|---|---|
| `service.py`, `generators.py` at the top level | Code in the `rag/` package: `settings`, `schemas`, `retrieval`, `indexing`, `generators`, `service`, `agent_tools` |
| Separate Dockerfiles in `deploy/` | One `Dockerfile`, three targets: `development` (docker compose), `rag` (the API) and `chroma` (Chroma that restores the knowledge from Cloud Storage when it starts) |
| `deploy/` with Cloud Build, `service.yaml`, `plan.json` | Removed. `docker-build-push.sh` builds and pushes the two images (`greenpath-rag-service`, `greenpath-rag-chroma`) and deploys nothing |
| Tests in git | Tests are local only (`src/rag-service/tests/` is ignored) |

- The knowledge is not embedded again on deploy: Chroma downloads the packaged index from Cloud Storage
  (`RAG_INDEX_URI`, checked against `RAG_INDEX_SHA256`, 398 passages) and loads it at startup.
- `rag/agent_tools.py` declares `search_cycling_knowledge` (retrieval only, no answer), ready to be a tool for a
  future route agent.
- Cloud Run: the live `greenpath-rag-service` (API + Chroma sidecar) still runs, but the repo no longer has a
  script that deploys it. On GKE it is deployed with everything else (below).

## 2. Kubernetes on GKE

Built the way the course's Kubernetes tutorial builds it: Pulumi for the cloud pieces, plain YAML for the
workloads. No service code changed; only `src/deployment/` did.

**New in `src/deployment/`**

| Path | What it does |
|---|---|
| `Dockerfile`, `docker-shell.sh`, `docker-entrypoint.sh` | The deployment container now also has kubectl, Pulumi and the GKE login plugin. It uses your gcloud login (no key file) and keeps Pulumi's state in `gs://<project>-pulumi-state-bucket` |
| `deploy_base/` | Pulumi: the Gateway's static IP |
| `deploy_images/` | Pulumi: builds and pushes frontend, api, rag and chroma, tagged by a hash of their files; pins the model's `:gpu` image |
| `deploy_k8s/` | Pulumi: VPC + Cloud NAT, a private GKE cluster, two node pools, Workload Identity |
| `k8s/base/` | The workloads (Deployments, Services, ConfigMaps, ServiceAccounts) |
| `k8s/gke/gateway.yaml` | The one public entrance: a Google load balancer, everything to the frontend, 15-minute timeout |
| `scripts/deploy-k8s.sh`, `scripts/destroy-k8s.sh` | Apply the workloads with this project's settings; take the cluster down in the right order |

**What runs** (namespace `greenpath`)

| Pod | Copies | Node pool |
|---|---|---|
| frontend | 2 | web: 3 × e2-standard-2 |
| api-service | 2 | web |
| rag-service, vector-db (Chroma) | 1 each | web |
| model-service | 4, one per node, 3 CPUs each | model: 4 × e2-standard-4, only model pods allowed |

Only the frontend is public. The other services call each other inside the cluster by name
(`http://api-service:9000`); pods reach Gemini and Cloud Storage as the same Google service accounts Cloud Run
uses (Workload Identity).

**Deploy** (inside `sh docker-shell.sh`; once before: push the model image with `src/model-service/docker-build-push.sh`)

```sh
cd /app/src/deployment/deploy_base   && pulumi stack select dev --create && pulumi up --stack dev -y   # static IP
cd /app/src/deployment/deploy_images && pulumi stack select dev --create && pulumi up --stack dev -y   # images
cd /app/src/deployment/deploy_k8s    && pulumi stack select dev --create && pulumi up --stack dev -y   # cluster, ~10 min
cd /app/src/deployment && ./scripts/deploy-k8s.sh                                                       # prints http://<IP>
```

Check with `kubectl -n greenpath get pods -o wide`. The cluster bills by the hour: take it down with
`./scripts/destroy-k8s.sh` when you are done (the IP and images stay). More in [src/deployment/README.md](src/deployment/README.md).

## 3. Cloud Run vs GKE

The same app, two deployments; they can run at the same time.

| | Cloud Run (live now) | GKE (new) |
|---|---|---|
| Model service | **GPU**: up to 3 instances in us-east4, 1 NVIDIA L4 each, 8 batches at a time | **CPU**: 4 pods × 3 CPUs, one batch at a time each |
| API → model concurrency | `MODEL_MAX_CONCURRENCY=24` | `MODEL_MAX_CONCURRENCY=4` (per API copy) |
| Speed (Boston, 2098 cells) | Fast | About 2 minutes |
| Model image | `greenpath-model-service:gpu` | The same image; with no GPU it scores on the CPU |
| Scaling and cost | Scales to 0, pay per use | Fixed 7 nodes, billed every hour it runs |
| Entrance | A `run.app` URL per service | One static IP through a Gateway |
| Service-to-service calls | HTTPS with ID tokens | Plain HTTP inside the cluster |
| Deploy with | `python cli.py --deploy` / `--test` | Pulumi + `scripts/deploy-k8s.sh` |

Why GKE is on CPU: our 3 L4s are Cloud Run quota. GKE uses the separate Compute Engine GPU quota, which allows
only 1 GPU for the whole project, and L4 machines are often unavailable in the zone. With more quota, GKE moves to
GPU by adding an L4 node pool and `nvidia.com/gpu: 1` to the model pods; the image does not change.
