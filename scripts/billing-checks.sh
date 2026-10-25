#!/usr/bin/env bash
set -euo pipefail
bun install --frozen-lockfile
node --test test/release/*.test.mjs
bun run test:workflows
bun run --cwd apps/api test --runInBand
bun run --cwd apps/api test:bun
bun run --cwd apps/api build
apps/api/node_modules/.bin/eslint --config apps/api/eslint.config.mjs 'apps/api/src/**/*.ts' 'test/api/**/*.ts'
bun run --cwd apps/web lint
bun run --cwd apps/web test
python3 -m unittest discover -s test/deploy -p 'test_*.py'
BILLING_API_ENV_FILE=/dev/null docker compose --env-file /dev/null build
bash scripts/billing-image-checks.sh
python3 test/docker/smoke.py
