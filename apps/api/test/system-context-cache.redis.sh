#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
container="billing-context-test-${RANDOM}-$$"
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --detach --rm --name "$container" -p 127.0.0.1::6379 redis:7-alpine >/dev/null
for attempt in {1..50}; do
  if docker exec "$container" redis-cli ping 2>/dev/null | grep -q PONG; then break; fi
  sleep 0.1
done
CONTEXT_TEST_REDIS_PORT="$(docker port "$container" 6379/tcp | awk -F: '{print $NF}')" node test/system-context-cache.redis.cjs
