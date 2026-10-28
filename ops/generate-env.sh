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
SUB2API_ADMIN_EMAIL="${SUB2API_ADMIN_EMAIL:-${ADMIN_EMAIL}}"
POSTGRES_PASSWORD="$(openssl rand -hex 24)"
APP_ENCRYPTION_KEY="$(openssl rand -hex 32)"
INTERNAL_API_SECRET="$(openssl rand -hex 32)"
N8N_ENCRYPTION_KEY="$(openssl rand -hex 32)"
ADMIN_PASSWORD="$(openssl rand -hex 16)"
SUB2API_ADMIN_PASSWORD="$(openssl rand -hex 16)"
SUB2API_DB_PASSWORD="$(openssl rand -hex 24)"
SUB2API_REDIS_PASSWORD="$(openssl rand -hex 24)"
SUB2API_JWT_SECRET="$(openssl rand -hex 32)"
SUB2API_TOTP_ENCRYPTION_KEY="$(openssl rand -hex 32)"

umask 077
sed \
  -e "s|replace-with-url-safe-random-password|${POSTGRES_PASSWORD}|" \
  -e "s|replace-with-app-encryption-key|${APP_ENCRYPTION_KEY}|" \
  -e "s|replace-with-internal-api-secret|${INTERNAL_API_SECRET}|" \
  -e "s|replace-with-a-long-random-string|${N8N_ENCRYPTION_KEY}|" \
  -e "s|^ADMIN_EMAIL=admin@example.com|ADMIN_EMAIL=${ADMIN_EMAIL}|" \
  -e "s|ADMIN_PASSWORD=replace-with-a-strong-admin-password|ADMIN_PASSWORD=${ADMIN_PASSWORD}|" \
  -e "s|^SUB2API_ADMIN_EMAIL=admin@example.com|SUB2API_ADMIN_EMAIL=${SUB2API_ADMIN_EMAIL}|" \
  -e "s|replace-with-a-strong-sub2api-admin-password|${SUB2API_ADMIN_PASSWORD}|" \
  -e "s|replace-with-sub2api-db-password|${SUB2API_DB_PASSWORD}|" \
  -e "s|replace-with-sub2api-redis-password|${SUB2API_REDIS_PASSWORD}|" \
  -e "s|replace-with-sub2api-jwt-secret|${SUB2API_JWT_SECRET}|" \
  -e "s|replace-with-sub2api-totp-key|${SUB2API_TOTP_ENCRYPTION_KEY}|" \
  .env.example > .env
chmod 600 .env

echo "Created .env with mode 600."
echo
echo "CokeAI admin email:    ${ADMIN_EMAIL}"
echo "CokeAI admin password: ${ADMIN_PASSWORD}"
echo "Sub2API admin email:   ${SUB2API_ADMIN_EMAIL}"
echo "Sub2API admin password: ${SUB2API_ADMIN_PASSWORD}"
echo
echo "Save both admin passwords now. They will not be shown again."
echo "Next: edit .env to add CLOUDFLARE_TUNNEL_TOKEN, pin SUB2API_IMAGE,"
echo "and add optional Stripe / Easypay / USDT credentials."
