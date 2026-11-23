import hashlib
import os
from pathlib import Path

import pulumi
import pulumi_docker_build as docker_build
import pulumi_gcp as gcp
from pulumi import CustomTimeouts

# The registry comes from the long-lived base stack
base = pulumi.StackReference(f"organization/greenpath-base/{pulumi.get_stack()}")
registry_url = base.require_output("registry")

# The images built here: (the service's folder, the image name, the Dockerfile target).
# rag-service has one Dockerfile with two targets: the RAG API and its Chroma database.
IMAGES = [
    ("frontend", "greenpath-frontend", None),
    ("api-service", "greenpath-api-service", None),
    ("rag-service", "greenpath-rag-service", "rag"),
    ("rag-service", "greenpath-rag-chroma", "chroma"),
]
# Never part of an image (and the same as the services' .dockerignore files)
SKIP = {
    ".git",
    ".venv",
    "node_modules",
    ".next",
    "__pycache__",
    ".pytest_cache",
    "docker-volumes",
    "outputs",
    ".DS_Store",
}


def content_tag(context: Path) -> str:
    """A tag from the service's files: unchanged code keeps its tag (and running pods), any change gets a
    new one. A timestamp would roll every pod on every `pulumi up`, a git commit would miss local edits."""
    digest = hashlib.sha256()
    for path in sorted(context.rglob("*")):
        if path.is_file() and not SKIP.intersection(path.relative_to(context).parts):
            digest.update(str(path.relative_to(context)).encode() + b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()[:12]


for folder, name, target in IMAGES:
    # ../../<folder> is the service's folder in the mounted repo (/app/src/<folder>)
    context_path = Path("../..") / folder
    image = docker_build.Image(
        f"build-{name}",
        tags=[pulumi.Output.concat(registry_url, "/", name, ":", content_tag(context_path))],
        context=docker_build.BuildContextArgs(location=str(context_path)),
        dockerfile=docker_build.DockerfileArgs(location=str(context_path / "Dockerfile")),
        target=target,
        platforms=[docker_build.Platform.LINUX_AMD64],  # GKE nodes are amd64
        push=True,
        opts=pulumi.ResourceOptions(custom_timeouts=CustomTimeouts(create="30m"), retain_on_delete=True),
    )
    # Export references to stack: the digest-pinned ref is what the workloads deploy
    pulumi.export(f"{name.removeprefix('greenpath-').replace('-', '_')}_ref", image.ref)

# The model image is not built here: CUDA torch makes it several GB, so model-service/docker-build-push.sh
# builds it in Cloud Build. Pin the :gpu image it pushed (without a GPU it scores on the CPU).
model = gcp.artifactregistry.get_docker_image(
    location=os.environ["GCP_REGION"], repository_id="greenpath", image_name="greenpath-model-service:gpu"
)
pulumi.export(
    "model_service_ref",
    pulumi.Output.concat(registry_url, "/greenpath-model-service:gpu@", model.self_link.split("@")[-1]),
)
