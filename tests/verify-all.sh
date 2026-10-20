#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
find functions -name '*.js' -print0 | xargs -0 -n 1 node --check
node --check dist/worker/index.js
node tests/parse-inline-scripts.mjs
node --experimental-default-type=module tests/api-smoke.mjs
python3 tests/sql-overlap-smoke.py
