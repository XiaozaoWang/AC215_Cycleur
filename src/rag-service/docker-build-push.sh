#!/bin/bash
# Host build/upload entry point, targeting Artifact Registry like model-service.
# Build the API and Chroma images from one Dockerfile; do not deploy Cloud Run or upload knowledge archives.
# Example: bash docker-build-push.sh --project PROJECT --region us-central1 --version v2 --no-push
# --no-push builds only; omit it to upload. Authenticate Docker to the registry separately first.
set -e
# Resolve the script directory so this works from any working directory.
export BASE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
# Priority: command-line arguments > environment variables > defaults. Do not source .env and load unrelated credentials.
export PROJECT=${RAG_GCP_PROJECT:-${GOOGLE_CLOUD_PROJECT:-${GCP_PROJECT:-}}}
export REGION=${GOOGLE_CLOUD_LOCATION:-us-central1}
export IMAGE_TAG=${APP_IMAGE_TAG:-latest}
PUSH=true
# Parse arguments one at a time; shift removes arguments already processed.
while [ "$#" -gt 0 ]; do
    case "$1" in
        --project|--region|--version)
            if [ "$#" -lt 2 ]; then
                echo "Missing value for $1" >&2
                exit 2
            fi
            case "$1" in
                --project) PROJECT=$2 ;;
                --region) REGION=$2 ;;
                --version) IMAGE_TAG=$2 ;;
            esac
            shift 2
            ;;
        --no-push)
            PUSH=false
            shift
            ;;
        *)
            echo "Usage: $0 --project PROJECT [--region REGION] [--version TAG] [--no-push]" >&2
            exit 2
            ;;
    esac
done
# Refuse to build with an empty project ID.
if [ -z "$PROJECT" ]; then
    echo "Set --project or RAG_GCP_PROJECT/GOOGLE_CLOUD_PROJECT/GCP_PROJECT" >&2
    exit 2
fi
# Image address: REGION-docker.pkg.dev/PROJECT/REPOSITORY/IMAGE:VERSION.
export REGISTRY="$REGION-docker.pkg.dev/$PROJECT/greenpath"
export RAG_IMAGE="$REGISTRY/greenpath-rag-service:$IMAGE_TAG"
export CHROMA_IMAGE="$REGISTRY/greenpath-rag-chroma:$IMAGE_TAG"
docker build --platform linux/amd64 --target rag -t "$RAG_IMAGE" -f "$BASE_DIR/Dockerfile" "$BASE_DIR"
docker build --platform linux/amd64 --target chroma -t "$CHROMA_IMAGE" -f "$BASE_DIR/Dockerfile" "$BASE_DIR"
# After both builds succeed, upload only if enabled; uploading does not update the running service.
if [ "$PUSH" = true ]; then
    docker push "$RAG_IMAGE"
    docker push "$CHROMA_IMAGE"
    echo "Pushed $RAG_IMAGE and $CHROMA_IMAGE"
fi
