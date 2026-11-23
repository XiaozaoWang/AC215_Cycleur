# Deployment

Two ways to run GreenPath, from the same deployment container (`sh docker-shell.sh`):
[Cloud Run](#cloud-run), one service at a time, or [Kubernetes on GKE](#kubernetes-on-gke), the whole app in one cluster.

## Cloud Run

One tool for the three Cloud Run services we deploy: `model` (model-service), `api` (api-service), `frontend`.
RAG is deployed separately (`src/rag-service/deploy`). Settings for each service are in the `SERVICES` table in `cli.py`.

| service | region | who can call it | instances | requests per instance | CPU / memory |
|---|---|---|---|---|---|
| model | us-east4 | api-service only | 0-3, one L4 GPU each | 8 | 8 / 32 GiB |
| api | us-central1 | frontend only | 0-1 | 20 | 2 / 2 GiB |
| frontend | us-central1 | everyone | 0-3 | 20 | 1 / 512 MiB |

The API sends at most `--model-concurrency` model calls at once (default: what model-service takes, 3 instances x 8 = 24). `--deploy --service api` refuses to deploy if the live model-service cannot take that many, so deploy the model first.
The model image is `:gpu` by default; `--tag latest` deploys the old CPU image.

```sh
# Mac: push the image of the service you changed
cd src/model-service && sh docker-build-push.sh        # builds in Cloud Build; or src/api-service, src/frontend
# Mac: open the tool
cd src/deployment && sh docker-shell.sh
# in the container
python cli.py --prepare                          # model only: copy the trained model into model-service/artifacts/ (before pushing)
python cli.py --deploy --service model
python cli.py --test --service model             # 50 validation cells must match training (--local: local container)
python cli.py --deploy --service api && python cli.py --test --service api --full
python cli.py --deploy --service frontend && python cli.py --test --service frontend
```

First time only: enable the Cloud Run Admin API and the Cloud Build API, create the service accounts `greenpath-model-service` (Storage Object Viewer on the bucket), `greenpath-api-service` (Vertex AI User, Storage Object Viewer) and `greenpath-frontend`, and get the Cloud Run quota of 3 NVIDIA L4 GPUs without zonal redundancy in us-east4.

## Kubernetes on GKE

The same images on a GKE cluster, built the way the Kubernetes tutorial builds it: Pulumi for the cloud pieces,
plain YAML for the workloads. The model runs on CPUs for now (GKE has no L4 quota yet).

| In the cluster (namespace `greenpath`) | Copies | Where | What it is |
|---|---|---|---|
| `frontend` | 2 | web pool | The page (Next.js); forwards `/api/*` to the API. The only thing reached from outside, through the Gateway |
| `api-service` | 2 | web pool | Reads the ride with Gemini, plans the routes, sends at most 4 batches at once to the model |
| `model-service` | 4 | model pool, one per node | Scores the cells, 3 CPUs each |
| `rag-service` | 1 | web pool | Answers questions with Gemini and Chroma |
| `vector-db` | 1 | web pool | Chroma; restores the knowledge from Cloud Storage when it starts, as on Cloud Run |

Run everything in the deployment container. First time only: push the model image with
`src/model-service/docker-build-push.sh` (the cluster uses its `:gpu` image).

```sh
# The static IP for the Gateway (once)
cd /app/src/deployment/deploy_base && pulumi stack select dev --create && pulumi up --stack dev -y
# Build and push frontend, api, rag and chroma (tagged by a hash of their files); pin the model image
cd /app/src/deployment/deploy_images && pulumi stack select dev --create && pulumi up --stack dev -y
# The network, the cluster and its two node pools (3 x e2-standard-2, 4 x e2-standard-4), about 10 minutes
cd /app/src/deployment/deploy_k8s && pulumi stack select dev --create && pulumi up --stack dev -y
# Apply k8s/gke with your project's settings and the pinned images, wait, and print the app's address
cd /app/src/deployment && ./scripts/deploy-k8s.sh
```

Watch it with `kubectl -n greenpath get pods -o wide`. A whole area takes about 2 minutes to score (4 pods x 3 CPUs).

| File | What it does |
|---|---|
| `deploy_base/__main__.py` | The Gateway's static IP (the image registry already exists) |
| `deploy_images/__main__.py` | Builds and pushes the images, tagged by a hash of their files; pins the model's `:gpu` image |
| `deploy_k8s/` | The network, Cloud NAT, the cluster, its web and model node pools, and Workload Identity |
| `k8s/base/` | The five workloads, the same on every cluster |
| `k8s/gke/gateway.yaml` | The Gateway: one public address, everything to the frontend, a 15-minute timeout |
| `scripts/deploy-k8s.sh` | Pins the images and your settings in an overlay (`.local/`), then applies `k8s/gke` |
| `scripts/destroy-k8s.sh` | Takes the cluster down in the right order |

The cluster bills by the hour, unlike Cloud Run: take it down when you are done (about 15 minutes):
`cd /app/src/deployment && ./scripts/destroy-k8s.sh`. First time only: enable the Kubernetes Engine API.
