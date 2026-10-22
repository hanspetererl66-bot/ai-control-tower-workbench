#!/usr/bin/env bash
# Runs as root on the VM (GCE startup script). Installs Docker, Zammad (official docker compose) and Caddy (HTTPS).
# Safe to run at every boot: it does the installation once.
set -euo pipefail
MARK=/var/lib/zammad-setup-done
meta() { curl -fs -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
DOMAIN="$(meta DOMAIN)"

if [ ! -f "$MARK" ]; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -y
  apt-get install -y git docker.io docker-compose-v2 caddy
  # Elasticsearch needs this kernel setting (docs.zammad.org, Docker Compose install)
  echo 'vm.max_map_count=262144' > /etc/sysctl.d/99-zammad.conf
  sysctl --system
  systemctl enable --now docker
  git clone https://github.com/zammad/zammad-docker-compose.git /opt/zammad-docker-compose
  cd /opt/zammad-docker-compose
  docker compose up -d
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
  reverse_proxy 127.0.0.1:8080
}
CADDY
  systemctl enable caddy
  systemctl restart caddy
  touch "$MARK"
fi
