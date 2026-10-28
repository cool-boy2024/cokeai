#!/usr/bin/env bash
# Activate the imported CokeAI workflows after the first deploy.
#
# n8n imports workflows as inactive on purpose. This script flips all imported
# workflows to active so the maintenance/pricing schedule actually runs.
#
# If your n8n version does not support --all, open the n8n UI and toggle each
# workflow from "Inactive" to "Active".
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f ops/sub2api/compose.yaml"

$COMPOSE exec -T n8n n8n update:workflow --all --active=true
$COMPOSE exec -T n8n n8n list:workflow

echo
echo "Workflows activated. Verify the schedule in the n8n UI:"
echo "  http://127.0.0.1:5678 (through an SSH tunnel; do not expose publicly)"
