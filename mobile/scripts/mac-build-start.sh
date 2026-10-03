#!/bin/bash
set -euo pipefail
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"
export NVM_DIR="$HOME/.nvm"
# nvm is not nounset-clean on every supported version.
set +u
source "$NVM_DIR/nvm.sh"
nvm use 22 --silent
set -u
cd "$(dirname "$0")/../.."
exec node mobile/scripts/mac-build-worker.mjs "${1:?Specify unsigned, archive or testflight}"
