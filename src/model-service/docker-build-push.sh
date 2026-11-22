#!/bin/bash
# Use before going to the cloud: build the image in Google's Cloud Build and store it in Artifact Registry, tagged :gpu. Then run `python cli.py --deploy --service model` in src/deployment
# Run it again after changing the model (--prepare) or the code. The image has the model, but no keys or tokens.
# Built in the cloud, not on your computer: CUDA torch makes the image several GB, Cloud Build downloads it inside Google and we only upload the code and artifacts/ (about 15 MB).
# Commands for first-time setup (once per project, once per person) are in data-processor/docker-build-push.sh

set -e

# Only take the project name line from .env (don't read tokens)
export $(grep '^GOOGLE_CLOUD_PROJECT=' "$(pwd)/../../.env")

export IMAGE_NAME="greenpath-model-service"
export IMAGE_URI="us-central1-docker.pkg.dev/$GOOGLE_CLOUD_PROJECT/greenpath/$IMAGE_NAME"

# Stop if the model isn't prepared
if [ ! -f artifacts/best_model.pt ]; then
    echo "artifacts/ is empty: run 'python cli.py --prepare' in src/deployment first"
    exit 1
fi

# Upload this folder (what is left out is in .gcloudignore), build it from the Dockerfile on an amd64 machine, and push the image.
# Tagged :gpu, so the old CPU image (:latest) stays in Artifact Registry and can still be deployed with --tag latest
gcloud builds submit --project "$GOOGLE_CLOUD_PROJECT" --region us-central1 --tag "$IMAGE_URI:gpu" .

echo "Pushed $IMAGE_URI:gpu"
