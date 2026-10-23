#!/usr/bin/env bash
set -euo pipefail
fixture_dir="$(cd "$(dirname "$0")" && pwd)"
exec bash "$fixture_dir/../database-optional/verify.sh"
