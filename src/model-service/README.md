# model-service

Private Cloud Run service `greenpath-model-service` (us-east4, one NVIDIA L4 GPU): send H3 cell ids, get 15 scenery scores (0 to 1) per cell. It reads the aerial tiles from the bucket itself.
api-service finds it through the `MODEL_SERVICE_URL` env var. The client that implements everything below is `src/api-service/api/model_client.py`.

## Endpoints

- `POST /predict` with `{"h3_indices": ["8a2802374807fff", ...]}`: 1 to 2000 H3 res-10 ids (more returns 422, duplicates are fine).
  Returns `{"run_id": "...", "results": [{"h3_index": "...", "status": "ok", "scores": {...}}, ...]}`, one result per id, in request order.
- `status`: `ok` (15 scores, 0 to 1, 4 decimals), `not_downloaded` (cell not in a collected area), `no_naip_coverage` / `mostly_black` (tile not usable). `scores` is `null` whenever status is not `ok`.
- `GET /health`: `{"status": "ok", "run_id", "training_id", "targets", "cells", "device"}`. `targets` is the score order, `cells` the number of scorable cells, `device` is `cuda` on the GPU, `cpu` elsewhere.
- `POST /predict_image`: multipart upload of one 256x256 aerial PNG in field `file`, returns `{"run_id", "scores"}` (for testing).

Score names, in order: `tree_canopy, forest_environment, grassland, open_landscape, road_width, water_access, urban_density, street_enclosure, farmland_pastoral, industrial_area, historic_character, commercial_district, scenic_appeal, architectural_character, visual_clutter`.

## Access

The caller's service account (e.g. `greenpath-api-service@<project>.iam.gserviceaccount.com`) needs `roles/run.invoker` on the service:
`gcloud run services add-iam-policy-binding greenpath-model-service --region us-east4 --member=serviceAccount:<that account> --role=roles/run.invoker`
Every call sends an ID token from `google.oauth2.id_token.fetch_id_token` with audience = the service URL (on Cloud Run this uses the caller's service account, no key file).
Locally, use an `http://` URL and no token: `gcloud run services proxy greenpath-model-service --region us-east4 --port 8080`, or this service via `sh docker-shell.sh`, then `MODEL_SERVICE_URL=http://host.docker.internal:8080`.

## Speed and batching

- Up to 3 instances (our quota is 3 L4 in us-east4), each 8 vCPU / 32 GiB + 1 L4, 0 when idle. It takes 8 requests at a time, so tiles for some batches download while the GPU scores others.
- Each request logs `download_s`, `decode_s` and `model_s` (bucket, CPU, GPU) next to `seconds`, to see which part is slow.
- api-service still splits a region into up to 30 batches of at least 10 cells, and sends at most 24 at once (`MODEL_MAX_CONCURRENCY`, 3 instances x 8), shared by all users.
- A GPU instance is billed while it is up (Cloud Run requires instance-based billing for GPUs), and stops about 15 minutes after the last request.
- Cold start pulls a bigger image (CUDA torch) and starts the GPU. Cloud Run may reject calls to a cold service (500, 429, 503), so `model_client.py` retries 429/5xx after waiting 2, 4, 8, then 15 s, up to 8 retries and about 90 s of waiting per batch. Time spent in Cloud Run's queue does not count, because Cloud Run can hold a request for 2 minutes before rejecting it. Request timeout is 300 s.
- The image uses the CUDA 12.6 build of torch on amd64 (it falls back to CPU without a GPU). A local build on an Apple chip Mac gets the CPU build.

## Run and deploy

`sh docker-shell.sh` builds and starts the service locally on CPU (try it at http://localhost:8080/docs). It needs `artifacts/`, made by `python cli.py --prepare` in `src/deployment`.
Deploy: `sh docker-build-push.sh` (builds in Cloud Build, stores `:gpu`), then inside `src/deployment/docker-shell.sh` run `python cli.py --deploy --service model` and `python cli.py --test --service model [--local]`. The old CPU image is still `:latest`.
