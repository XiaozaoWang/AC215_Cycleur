# Image for the deployment tool. Runs on your computer, never in the cloud. No keys or .env inside;
# your gcloud login is mounted at run time (docker-shell.sh).
#   Cloud Run:   python cli.py --prepare / --deploy / --test
#   Kubernetes:  the Pulumi stacks (deploy_base, deploy_images, deploy_k8s), kubectl and scripts/

FROM python:3.12-slim-bookworm

# Every tool the deployment needs, at pinned versions, so Docker is the only thing a laptop needs.
# The same tools and versions as the Kubernetes tutorial (without kind: we only deploy to GKE).
ARG TARGETARCH
ARG KUBECTL_VERSION=v1.37.1
ARG PULUMI_VERSION=3.272.0

# uv installs into /.venv, outside /app, so mounting the repo on /app does not hide it
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/.venv \
    PATH=/.venv/bin:/usr/local/lib/pulumi:${PATH}

# No Pulumi passphrase prompts: our stacks hold no secrets, and the state bucket's IAM decides who reads it
ENV PULUMI_CONFIG_PASSPHRASE=""

# The Docker CLI (deploy_images builds on your computer's Docker, through its socket), gcloud, and the
# plugin that lets kubectl sign in to GKE with your gcloud login
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg jq \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
    && chmod a+r /etc/apt/keyrings/docker.asc \
    && echo "deb [arch=${TARGETARCH} signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
    && curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /etc/apt/keyrings/cloud.google.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" > /etc/apt/sources.list.d/google-cloud-sdk.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
        google-cloud-cli google-cloud-cli-gke-gcloud-auth-plugin \
    && rm -rf /var/lib/apt/lists/*

# kubectl, checked against its published checksum
RUN curl -fsSLo /tmp/kubectl "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" \
    && curl -fsSLo /tmp/kubectl.sha256 "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl.sha256" \
    && echo "$(cat /tmp/kubectl.sha256)  /tmp/kubectl" | sha256sum --check \
    && install -m 0755 /tmp/kubectl /usr/local/bin/kubectl \
    && rm /tmp/kubectl /tmp/kubectl.sha256

# Pulumi (it names amd64 "x64"), checked against its published checksums; then uv
RUN arch="$([ "${TARGETARCH}" = amd64 ] && echo x64 || echo "${TARGETARCH}")" \
    && tarball="pulumi-v${PULUMI_VERSION}-linux-${arch}.tar.gz" \
    && base="https://github.com/pulumi/pulumi/releases/download/v${PULUMI_VERSION}" \
    && cd /tmp \
    && curl -fsSLO "${base}/${tarball}" \
    && curl -fsSLO "${base}/pulumi-${PULUMI_VERSION}-checksums.txt" \
    && grep " ${tarball}\$" "pulumi-${PULUMI_VERSION}-checksums.txt" | sha256sum --check \
    && tar -xzf "${tarball}" \
    && mv pulumi /usr/local/lib/pulumi \
    && rm "${tarball}" "pulumi-${PULUMI_VERSION}-checksums.txt" \
    && pip install --no-cache-dir uv

# Runs as root, like the tutorial's container: it drives your computer's Docker through its socket
WORKDIR /app

# dependencies first, so this layer stays cached when only the code changes
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen

# code (docker-shell.sh mounts the whole repo on /app anyway, so the latest local code is used)
COPY . ./

ENTRYPOINT ["/bin/bash","docker-entrypoint.sh"]
