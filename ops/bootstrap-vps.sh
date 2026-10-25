#!/usr/bin/env bash
# Run once on a fresh Ubuntu/Debian VPS as root.
# This does not expose application ports publicly; Cloudflare Tunnel is the ingress.
set -euo pipefail

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash ops/bootstrap-vps.sh"
  exit 1
fi

SSH_PORT="${SSH_PORT:-22}"
APP_DIR="${APP_DIR:-/opt/cokeai}"

echo "==> Installing base packages"
apt-get update -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
  ca-certificates curl gnupg ufw fail2ban rsync git openssl

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

systemctl enable --now docker

if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
  usermod -aG docker "${SUDO_USER}" || true
fi

echo "==> Configuring Docker log rotation"
mkdir -p /etc/docker
cat >/etc/docker/daemon.json <<'JSON'
{
  "live-restore": true,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
JSON
systemctl restart docker

echo "==> Preparing application directory"
mkdir -p "${APP_DIR}/n8n/workflows"
chmod 755 "${APP_DIR}"

echo "==> Configuring firewall"
ufw allow "${SSH_PORT}/tcp"
ufw --force enable
systemctl enable --now fail2ban

if [[ ! -f /swapfile ]] && [[ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 2000000 ]]; then
  echo "==> Creating 2GB swap"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo
echo "Server bootstrap complete."
echo "Next steps:"
echo "1. Copy the repository to ${APP_DIR}, or use the GitHub deploy workflow."
echo "2. Run: cd ${APP_DIR} && bash ops/generate-env.sh"
echo "3. Edit .env and add CLOUDFLARE_TUNNEL_TOKEN."
echo "4. Run: docker compose --profile tunnel up -d --build"
echo
echo "Firewall only allows SSH (${SSH_PORT}) and Docker-internal traffic."
echo "If you use a non-standard SSH port, rerun with SSH_PORT=<port>."
