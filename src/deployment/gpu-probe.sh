#!/bin/bash
# Find out which zone can really start an L4 GPU right now (run it on the Mac, with your gcloud login)
#
#   sh gpu-probe.sh --quota                 read only: quotas (L4 limit / used per region, global GPU limit)
#   sh gpu-probe.sh --list                  read only: zones that have L4
#   sh gpu-probe.sh                         try it: start a machine with 1 L4 in each zone of us-central1, us-east4 in turn, delete it at once, stop at the first that works
#   sh gpu-probe.sh --all                   try it: every zone (each machine is deleted before the next try)
#   sh gpu-probe.sh --regions "us-central1 us-west1 us-east1"     other regions
#
# Trying really creates a machine (g2-standard-4 comes with 1 L4), deleted after a few tens of seconds, about 1 cent each time.
# No external IP, 10 GB disk; Ctrl+C halfway still deletes the machine.

set -u
PROJECT="${PROJECT:-organic-victory-508017-v9}"
REGIONS="us-central1 us-east4"
MODE=probe
ALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --quota) MODE=quota ;;
    --list) MODE=list ;;
    --all) ALL=1 ;;
    --regions) shift; REGIONS="$1" ;;
    --project) shift; PROJECT="$1" ;;
    *) echo "unknown option: $1"; exit 1 ;;
  esac
  shift
done

# Zones that have L4 (only nvidia-l4, not nvidia-l4-vws)
zones() {
  local pattern
  pattern=$(echo "$REGIONS" | sed 's/ /|/g')
  gcloud compute accelerator-types list --project="$PROJECT" --format="value(name,zone)" 2>/dev/null \
    | awk '$1 == "nvidia-l4" {print $2}' | grep -E "^(${pattern})-" | sort
}

if [ "$MODE" = quota ]; then
  echo "project: $PROJECT"
  gcloud compute project-info describe --project="$PROJECT" --format=json 2>/dev/null \
    | python3 -c 'import json,sys; q={x["metric"]:x for x in json.load(sys.stdin)["quotas"]}; g=q.get("GPUS_ALL_REGIONS",{}); lim=g.get("limit",0); use=g.get("usage",0); print(f"GPUS_ALL_REGIONS (global): limit {lim:g}, used {use:g}")'
  for r in $REGIONS; do
    gcloud compute regions describe "$r" --project="$PROJECT" --format=json 2>/dev/null \
      | python3 -c 'import json,sys; d=json.load(sys.stdin); q={x["metric"]:x for x in d["quotas"]}
for m in ("NVIDIA_L4_GPUS","PREEMPTIBLE_NVIDIA_L4_GPUS","CPUS"):
    x=q.get(m,{}); r=d["name"]; lim=x.get("limit",0); use=x.get("usage",0); print(f"{r:<14} {m:<28} limit {lim:g}, used {use:g}")'
  done
  exit 0
fi

ZONES=$(zones)
if [ -z "$ZONES" ]; then echo "no L4 zones found in: $REGIONS"; exit 1; fi
if [ "$MODE" = list ]; then echo "$ZONES"; exit 0; fi

NAME="gpu-probe-$(date +%s)"
CURRENT=""
cleanup() {
  if [ -n "$CURRENT" ]; then
    gcloud compute instances delete "$NAME" --project="$PROJECT" --zone="$CURRENT" --quiet >/dev/null 2>&1
    CURRENT=""
  fi
}
trap 'cleanup; exit 130' INT TERM

echo "project $PROJECT · machine g2-standard-4 (1 x L4) · $(date '+%Y-%m-%d %H:%M')"
FOUND=""
for z in $ZONES; do
  printf "%-16s " "$z"
  CURRENT="$z"
  out=$(gcloud compute instances create "$NAME" --project="$PROJECT" --zone="$z" \
          --machine-type=g2-standard-4 --image-family=debian-12 --image-project=debian-cloud \
          --boot-disk-size=10GB --no-address --labels=purpose=gpu-probe --quiet 2>&1)
  if echo "$out" | grep -q "RUNNING"; then
    echo "AVAILABLE"
    FOUND="$FOUND $z"
    cleanup
    [ "$ALL" = 1 ] || break
  else
    CURRENT=""     # nothing was created
    reason=$(echo "$out" | grep -oE "ZONE_RESOURCE_POOL_EXHAUSTED|QUOTA_EXCEEDED|Quota '[^']+'|does not have enough resources" | head -1)
    echo "no  (${reason:-$(echo "$out" | grep -m1 ERROR | cut -c1-90)})"
  fi
done
trap - INT TERM

# Finally, make sure no probe machine is left
left=$(gcloud compute instances list --project="$PROJECT" --filter="labels.purpose=gpu-probe" --format="value(name,zone)" 2>/dev/null)
[ -n "$left" ] && echo "WARNING: probe machines still exist:" && echo "$left"
echo "available:${FOUND:- none}"
