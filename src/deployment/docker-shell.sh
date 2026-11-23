#!/bin/bash
# Build the deployment image and open a shell in it (run it again from another terminal for a second shell).
#   Cloud Run:   python cli.py --prepare / --deploy / --test
#   Kubernetes:  the Pulumi stacks (deploy_base, deploy_images, deploy_k8s) and ./scripts/deploy-k8s.sh
# The whole repo is mounted: --prepare reads model-training/, deploy_images builds the services' folders.
# Your gcloud login is mounted read-only (docker-entrypoint.sh copies it inside the container), so the
# bucket, Cloud Run and GKE are used as you. No key files. .env is passed with --env-file, never baked in.

set -e

export GCLOUD_CONFIG_DIR="${GCLOUD_CONFIG_DIR:-$HOME/.config/gcloud}"   # override on Windows (AppData/Roaming/gcloud)
export IMAGE_NAME="greenpath-deployment"
export BASE_DIR=$(pwd)
export REPO_DIR=$(cd ../.. && pwd)
export ENV_FILE=$REPO_DIR/.env
export GCP_REGION="us-central1"
export GCP_ZONE="us-central1-a"

# Kept between runs, like the tutorial: Pulumi's plugins and the Docker login (a folder, not one file:
# gcloud replaces config.json by renaming over it)
mkdir -p "$BASE_DIR/pulumi-plugins" "$BASE_DIR/docker-config"

# Already running: open another shell in the same container
if docker ps --format "{{.Names}}" | grep -q "^${IMAGE_NAME}$"; then
    exec docker exec -it $IMAGE_NAME /bin/bash docker-entrypoint.sh
fi

docker build -t $IMAGE_NAME -f Dockerfile .

# The Docker socket: deploy_images builds the images on your computer's Docker
docker run --rm --name $IMAGE_NAME -ti \
-v /var/run/docker.sock:/var/run/docker.sock \
-v "$REPO_DIR":/app \
-w /app/src/deployment \
-v "$GCLOUD_CONFIG_DIR":/root/.config/gcloud-host:ro \
-v "$BASE_DIR/docker-config":/root/.docker \
-v "$BASE_DIR/pulumi-plugins":/root/.pulumi/plugins \
-e GCP_REGION=$GCP_REGION \
-e GCP_ZONE=$GCP_ZONE \
--env-file "$ENV_FILE" \
$IMAGE_NAME
