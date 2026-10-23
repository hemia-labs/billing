#!/usr/bin/env bash
set -euo pipefail
BILLING_TEST_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
cd "$BILLING_TEST_ROOT/apps/api"
container="billing-context-test-${RANDOM}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --name "$container" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for attempt in {1..50}; do
  if docker exec "$container" redis-cli ping 2>/dev/null | grep -q PONG; then break; fi
  sleep 0.1
done
CONTEXT_TEST_REDIS_PORT="$(docker port "$container" 6379/tcp | awk -F: '{print $NF}')" node "$BILLING_TEST_ROOT/test/api/integration/context-cache/system-context-cache.redis.cjs"
