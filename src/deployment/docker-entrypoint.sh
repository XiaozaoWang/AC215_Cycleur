#!/bin/bash
# First script in the container: sign in with your gcloud login, point Pulumi at its state bucket, leave a shell open

echo "Container is running!!!"
echo "Architecture: $(uname -m) · $(python --version) · kubectl $(kubectl version --client -o json | jq -r .clientVersion.gitVersion) · pulumi $(pulumi version)"
echo "Project: $GOOGLE_CLOUD_PROJECT · Bucket: $GREENPATH_BUCKET"
docker info >/dev/null 2>&1 || echo "WARNING: cannot reach Docker through /var/run/docker.sock"

source /.venv/bin/activate

# Your gcloud login, copied from the read-only mount: gcloud and kubectl write tokens next to it
[[ -d /root/.config/gcloud ]] || cp -r /root/.config/gcloud-host /root/.config/gcloud
gcloud config set project "$GOOGLE_CLOUD_PROJECT" --quiet
# Docker pushes to Artifact Registry with this login
gcloud auth configure-docker "$GCP_REGION-docker.pkg.dev" --quiet

# The GKE cluster's credentials stay in the ignored .local/, so they outlive this container
mkdir -p .local
export KUBECONFIG=$PWD/.local/kubeconfig

# Pulumi records what it made in a bucket, created the first time
export PULUMI_BUCKET="gs://$GOOGLE_CLOUD_PROJECT-pulumi-state-bucket"
if ! gcloud storage buckets describe "$PULUMI_BUCKET" >/dev/null 2>&1; then
    gcloud storage buckets create "$PULUMI_BUCKET" --location "$GCP_REGION" --uniform-bucket-level-access
fi
pulumi login "$PULUMI_BUCKET"

echo -en "\033[92m
Cloud Run:   python cli.py --deploy --service model|api|frontend, then --test (README.md)
Kubernetes:  cd /app/src/deployment/deploy_base   && pulumi stack select dev --create && pulumi up --stack dev -y
             cd /app/src/deployment/deploy_images && pulumi stack select dev --create && pulumi up --stack dev -y
             cd /app/src/deployment/deploy_k8s    && pulumi stack select dev --create && pulumi up --stack dev -y
             cd /app/src/deployment && ./scripts/deploy-k8s.sh      (./scripts/destroy-k8s.sh to take it down)
\033[0m
"
exec /bin/bash
