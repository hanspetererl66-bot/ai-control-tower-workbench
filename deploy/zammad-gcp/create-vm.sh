#!/usr/bin/env bash
# Creates a VM with Zammad behind HTTPS in your Google Cloud project. Run it in Cloud Shell.
#   REGION=europe-west3 ZONE=europe-west3-a DOMAIN=support.example.com bash create-vm.sh
# Without DOMAIN the script uses <ip>.sslip.io, a free name that points to the IP (good for a demo).
# Needs: a project with billing and the Compute Engine API (gcloud config set project <id>).
set -euo pipefail
REGION="${REGION:-europe-west3}"
ZONE="${ZONE:-europe-west3-a}"
NAME="${NAME:-zammad}"
TYPE="${TYPE:-e2-standard-2}"   # 2 vCPU, 8 GB RAM. 4 GB is the minimum for the containers.
DISK="${DISK:-40GB}"
HERE="$(cd "$(dirname "$0")" && pwd)"

gcloud compute addresses create "$NAME-ip" --region "$REGION"
IP="$(gcloud compute addresses describe "$NAME-ip" --region "$REGION" --format='value(address)')"
DOMAIN="${DOMAIN:-${IP//./-}.sslip.io}"

# Only web ports are opened. Zammad's own port 8080 stays closed to the internet.
gcloud compute firewall-rules create "$NAME-web" --allow tcp:80,tcp:443 --target-tags "$NAME-web" --direction INGRESS

gcloud compute instances create "$NAME" \
  --zone "$ZONE" --machine-type "$TYPE" \
  --image-family ubuntu-2404-lts-amd64 --image-project ubuntu-os-cloud \
  --boot-disk-size "$DISK" --boot-disk-type pd-balanced \
  --tags "$NAME-web" --address "$IP" \
  --metadata "DOMAIN=$DOMAIN" --metadata-from-file "startup-script=$HERE/startup.sh"

echo
echo "VM created. IP: $IP"
echo "If you use your own domain: create an A record  $DOMAIN -> $IP  now (Let's Encrypt needs it)."
echo "Zammad needs about 5 to 10 minutes to start. Then open: https://$DOMAIN"
echo "Follow the setup wizard, then: Profile > Token Access > create a token with permission ticket.agent."
echo "In Zammad: Settings > System > Base: set the Fully Qualified Domain Name to $DOMAIN and the HTTP type to https."
echo "Progress on the VM:  gcloud compute ssh $NAME --zone $ZONE --command 'sudo journalctl -u google-startup-scripts -n 50'"
