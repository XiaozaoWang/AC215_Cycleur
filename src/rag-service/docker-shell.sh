#!/bin/bash

# Build the development image and open a shell, like api-service/docker-shell.sh.
# Usage: bash docker-shell.sh [python cli.py --help]
set -e

# Resolve paths from this script so callers can run it from any directory.
export BASE_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
export REPO_DIR=$(cd -- "$BASE_DIR/../.." && pwd)
export ENV_FILE="$REPO_DIR/.env"

# Compose supplies code/credential mounts, ports and the Chroma dependency.
# Use the repository root docker-compose.yml as the single service definition.
docker_compose() {
    if [ -f "$ENV_FILE" ]; then
        docker compose --env-file "$ENV_FILE" -f "$REPO_DIR/docker-compose.yml" "$@"
    else
        docker compose -f "$REPO_DIR/docker-compose.yml" "$@"
    fi
}

# Build the image using the development target in docker-compose.yml.
docker_compose build rag-api

# Open Bash by default, or run the caller's command.
# --rm removes only this temporary container; Chroma's persistent data remains.
if [ "$#" -eq 0 ]; then
    docker_compose run --rm --service-ports rag-api /bin/bash
else
    docker_compose run --rm --service-ports rag-api "$@"
fi
