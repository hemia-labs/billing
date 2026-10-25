#!/usr/bin/env bash
set -euo pipefail
BILLING_TEST_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$BILLING_TEST_ROOT/apps/api"
container="hemia-billing-addon-cancellation-test-$$"
trap 'docker stop "$container" >/dev/null 2>&1 || true' EXIT
# No mounts or application credentials; --rm removes the disposable data volume.
docker run --detach --rm --name "$container" --publish 127.0.0.1::5432 \
  --env POSTGRES_PASSWORD=isolated-test-only --env POSTGRES_DB=billing_be002_test postgres:18.4 >/dev/null
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U postgres -d billing_be002_test >/dev/null 2>&1; then break; fi
  sleep 1
done
TEST_DATABASE_PORT="$(docker port "$container" 5432 | awk -F: '{print $NF}')" \
  TS_NODE_TRANSPILE_ONLY=false node -r ts-node/register "$BILLING_TEST_ROOT/test/api/integration/subscription-addons/subscription-addon-cancellation.integration.cjs"
