#!/bin/sh
# Development only: works around CarPlayTemplateUIHost crashing on every CPMapTemplate in the iOS 26.4/26.5
# simulators (https://github.com/mapbox/mapbox-navigation-ios/issues/4827). Never ship this in an app.
# Usage: shim.sh inject|cleanup <simulator UDID>
set -eu

dir=$(cd "$(dirname "$0")" && pwd)
dylib="$dir/build/CPSDestinationSharingShim.dylib"
udid=${2:?usage: $0 inject|cleanup <simulator UDID>}

case "${1:-}" in
  inject)
    mkdir -p "$dir/build"
    xcrun -sdk iphonesimulator clang -arch arm64 -mios-simulator-version-min=26.0 -dynamiclib -fobjc-arc \
      -framework Foundation -o "$dylib" "$dir/CPSDestinationSharingShim.m"
    codesign -f -s - "$dylib"
    xcrun simctl spawn "$udid" launchctl setenv DYLD_INSERT_LIBRARIES "$dylib"
    ;;
  cleanup)
    xcrun simctl spawn "$udid" launchctl unsetenv DYLD_INSERT_LIBRARIES
    ;;
  *)
    echo "usage: $0 inject|cleanup <simulator UDID>" >&2
    exit 1
    ;;
esac

# The host relaunches on demand and picks up the new environment.
pkill -f CarPlayTemplateUIHost.app/CarPlayTemplateUIHost || true
