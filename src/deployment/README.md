# Deployment

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
