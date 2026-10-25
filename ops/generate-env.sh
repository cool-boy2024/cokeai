#!/usr/bin/env bash
set -euo pipefail

if [[ -f .env ]]; then
  echo ".env already exists; refusing to overwrite."
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required."
  exit 1
fi

ADMIN_EMAIL="${ADMIN_EMAIL:-admin@cokeai.cc.cd}"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
INTERNAL_API_SECRET="$(openssl rand -hex 32)"
N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -hex 16)"

umask 077
sed \
  -e "s|replace-with-url-safe-random-password|${POSTGRES_PASSWORD}|" \
  -e "s|replace-with-app-encryption-key|${APP_ENCRYPTION_KEY}|" \
  -e "s|replace-with-internal-api-secret|${INTERNAL_API_SECRET}|" \
  -e "s|replace-with-a-long-random-string|${N8N_ENCRYPTION_KEY}|" \
  -e "s|ADMIN_EMAIL=admin@example.com|ADMIN_EMAIL=${ADMIN_EMAIL}|" \
  -e "s|ADMIN_PASSWORD=replace-with-a-strong-admin-password|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" \
  .env.example > .env
chmod 600 .env

echo "Created .env with mode 600."
echo
echo "Admin email:    ${ADMIN_EMAIL}"
echo "Admin password: ${ADMIN_PASSWORD}"
echo
echo "Save the admin password now. It will not be shown again."
echo "Next: edit .env to add CLOUDFLARE_TUNNEL_TOKEN, ALERT_WEBHOOK_URL and optional Stripe keys."
