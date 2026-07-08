#!/usr/bin/env bash
# Push from VPS using org SSH key (configured in local core.sshCommand).
set -euo pipefail
cd "$(dirname "$0")/.."
git push "$@"
