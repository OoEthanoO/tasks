#!/bin/bash
# Build the iOS app on this Mac and upload it to TestFlight. The build runs
# locally with `eas build --local`, so it does not use Expo's monthly cloud
# build quota; signing credentials and the build number still come from the
# Expo account. Needs Xcode, CocoaPods, fastlane, Node and eas-cli, and
# `eas login` done once (see mobile/README.md).
#
# Legacy fallback; the default is the Mac build server (mobile/MAC_BUILDER.md).
#   bash mobile/scripts/build-ios.sh
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo/mobile"
# CocoaPods refuses to run without a UTF-8 locale.
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

npm ci --no-audit --no-fund
mkdir -p build
ipa="$PWD/build/yantasks-$(date +%Y%m%d-%H%M%S).ipa"

# caffeinate keeps the Mac awake until the build finishes. eas packs the whole
# repository (the app imports ../lib), filtered by the root .easignore.
caffeinate -ims eas build --platform ios --profile production --local --non-interactive --output "$ipa"
eas submit --platform ios --profile production --path "$ipa" --non-interactive

echo "Uploaded $ipa. Apple processes it for TestFlight in about 5-10 minutes."
