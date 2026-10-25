#!/usr/bin/env bash
set -euo pipefail
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
billing_root="$(cd "$fixture_dir/../../../.." && pwd)"
fixture_workspace="$(mktemp -d "${TMPDIR:-/tmp}/hemia-payments-optional.XXXXXX")"
pg_container="hemia-payments-optional-pg-$$"
mysql_container="hemia-payments-optional-mysql-$$"
cleanup() {
  docker rm -f -v "$pg_container" "$mysql_container" >/dev/null 2>&1 || true
  rm -rf "$fixture_workspace"
}
trap cleanup EXIT
cp "$fixture_dir"/*.cjs "$fixture_dir/package.json" "$fixture_workspace/"
(cd "$billing_root/packages/payments" && npm pack --silent --ignore-scripts --pack-destination "$fixture_workspace" >/dev/null)
mv "$fixture_workspace"/hemia-payments-*.tgz "$fixture_workspace/payments.tgz"
node - "$fixture_workspace/package.json" <<'JS'
const fs = require('node:fs');
const path = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path));
manifest.dependencies['@hemia/payments'] = 'file:./payments.tgz';
fs.writeFileSync(path, JSON.stringify(manifest));
JS
(cd "$fixture_workspace" && npm install --ignore-scripts --no-audit --no-fund --package-lock=false)
docker run -d --rm --name "$pg_container" -p 127.0.0.1::5432 -e POSTGRES_PASSWORD=optional-fixture-only -e POSTGRES_DB=payments_optional_test postgres:18.4 >/dev/null
docker run -d --rm --name "$mysql_container" -p 127.0.0.1::3306 -e MYSQL_ROOT_PASSWORD=optional-fixture-only -e MYSQL_ROOT_HOST=% -e MYSQL_DATABASE=payments_optional_test mysql:8.4 >/dev/null
for attempt in {1..90}; do
  if docker exec "$pg_container" pg_isready -U postgres >/dev/null 2>&1 && docker exec "$mysql_container" mysqladmin ping -h127.0.0.1 -uroot -poptional-fixture-only --silent >/dev/null 2>&1; then break; fi
  sleep 1
done
PAYMENTS_OPTIONAL_PG_PORT="$(docker port "$pg_container" 5432/tcp | awk -F: '{print $NF}')" \
PAYMENTS_OPTIONAL_MYSQL_PORT="$(docker port "$mysql_container" 3306/tcp | awk -F: '{print $NF}')" \
node --test "$fixture_workspace/integration.test.cjs"
