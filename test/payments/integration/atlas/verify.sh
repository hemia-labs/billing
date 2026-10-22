#!/usr/bin/env bash
set -euo pipefail
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
billing_root="$(cd "$fixture_dir/../../../.." && pwd)"
workspace="$(mktemp -d "${TMPDIR:-/tmp}/hemia-atlas-package.XXXXXX")"
container="hemia-atlas-payments-$$"
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; rm -rf "$workspace"; }
trap cleanup EXIT
cp "$fixture_dir"/*.cjs "$fixture_dir/package.json" "$workspace/"
# Pack/install the actual distribution. No source paths or workspace symlinks are imported.
if [[ -n "${PAYMENTS_TARBALL:-}" ]]; then
  cp "$PAYMENTS_TARBALL" "$workspace/payments.tgz"
else
  (cd "$billing_root/packages/payments" && npm pack --silent --ignore-scripts --pack-destination "$workspace" >/dev/null)
  mv "$workspace"/hemia-payments-*.tgz "$workspace/payments.tgz"
fi
node - "$workspace/package.json" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path));
manifest.dependencies['@hemia/payments'] = 'file:./payments.tgz';
fs.writeFileSync(path, JSON.stringify(manifest, null, 2));
JS
(cd "$workspace" && npm install --ignore-scripts --no-audit --no-fund --package-lock=false)
docker run -d --rm --name "$container" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=isolated-atlas-only postgres:18.4 >/dev/null
for attempt in {1..60}; do
  if docker exec "$container" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" createdb -U postgres atlas_payments_test
ATLAS_TEST_PG_PORT="$(docker port "$container" 5432/tcp | awk -F: '{print $NF}')" node --test "$workspace/integration.test.cjs"
