# @rnmapbox/navigation

_A community-supported, open-source React Native library for the [Mapbox Navigation SDK v3](https://docs.mapbox.com/navigation/) for iOS and Android, built on [`@rnmapbox/maps`](https://github.com/rnmapbox/maps)._

It requests routes, runs an active-guidance session and reports route progress, and the Navigation SDK draws the route line, the puck and the navigation camera on a regular `@rnmapbox/maps` `MapView`. `<NavigationView>` shows the SDK's full-screen turn-by-turn UI instead.

> Status: early alpha, not published to npm yet. APIs may change.

## Requirements

- React Native 0.79+ with the New Architecture.
- [`@rnmapbox/maps`](https://github.com/rnmapbox/maps) >= 10.3.11 (peer dependency).
- iOS: React Native's minimum deployment target (15.1 for React Native 0.84; the Navigation SDK itself needs iOS 14). Mapbox Navigation SDK for iOS 3.23.1 (`MapboxNavigationCore` and `MapboxNavigationUIKit`), added as a Swift package.
- Android: `minSdkVersion` 24, `compileSdkVersion` 36. Mapbox Navigation SDK for Android 3.23.1 (`com.mapbox.navigationcore:navigation`, `ui-maps` and `ui-components`).
- A [Mapbox account](https://account.mapbox.com/auth/signup/) and a public access token (`pk.…`). Neither platform needs a secret downloads token: the Android release artifacts and the iOS Swift package binaries download without one.

Navigation is billed per trip or MAU to the access token you pass, on top of Maps usage. See [Navigation SDK pricing](https://www.mapbox.com/pricing#navigation).

## Installation

```sh
yarn add @rnmapbox/navigation @rnmapbox/maps
```

There's no Expo config plugin yet. With Expo, use a development build and apply the native setup below yourself.

### iOS

The Navigation SDK v3 is only distributed as a Swift package. `@rnmapbox/navigation` links it, and through it MapboxMaps, into the app.
`@rnmapbox/maps` must only compile against that MapboxMaps (its compile-only Swift Package Manager mode). Otherwise the app links two copies of MapboxMaps and fails with duplicate symbols.

```ruby
# ios/Podfile, before `target`
$RNMapboxMapsSwiftPackageManager = { link: false }

target 'YourApp' do
  # ...
  pre_install do |installer|
    $RNMapboxMaps.pre_install(installer)
  end

  post_install do |installer|
    react_native_post_install(installer, ...)
    $RNMapboxMaps.post_install(installer)
  end
end
```

`pod install` adds `MapboxCommon`, `MapboxCoreMaps`, `MapboxNavigationNative` and `Turf` to the frameworks CocoaPods embeds; Xcode doesn't embed the dynamic frameworks of a package that's only linked through a pod. It uses the helper in `@rnmapbox/maps`' `ios/rnmapbox_spm.rb`.

Add `NSLocationWhenInUseUsageDescription` to your `Info.plist`. For `<NavigationView>`, also add `audio` to `UIBackgroundModes`: the SDK's voice controller asserts on it in debug builds.

Podfile options (set them before `use_native_modules!`):

```ruby
# Navigation SDK version, defaults to package.json `mapboxNavigation.ios`. Nav 3.N pins Maps 11.N.
$RNMapboxNavigationVersion = '3.23.1'
# Don't add the Swift package; add mapbox-navigation-ios (products MapboxNavigationCore and
# MapboxNavigationUIKit) yourself.
$RNMapboxNavigationSwiftPackageManager = 'manual'
```

`@rnmapbox/maps`' package requirement comes from `$RNMapboxMapsVersion` (default `~> 11.23.1`), and must be compatible with the Maps version the Navigation SDK pins, otherwise Xcode reports a package resolution error. With a newer Navigation SDK, set `$RNMapboxMapsVersion = '= 11.N.x'` to match.

### Android

Add the Mapbox Maven repository, the same one `@rnmapbox/maps` uses.

```groovy
// android/build.gradle
buildscript {
    ext {
        // Nav 3.23.1 pins Maps 11.23.1. Both packages must resolve the same Maps.
        RNMapboxMapsVersion = '11.23.1'
        // Optional, defaults to package.json `mapboxNavigation.android`.
        RNMapboxNavigationVersion = '3.23.1'
    }
}

allprojects {
    repositories {
        maven { url 'https://api.mapbox.com/downloads/v2/releases/maven' }
    }
}
```

`@rnmapbox/navigation` adds a strict constraint on the Maps version its Navigation SDK is built against (Nav 3.N → Maps 11.N, or `RNMapboxNavigationMapsVersion`), so a different `RNMapboxMapsVersion` fails dependency resolution instead of silently mixing versions.

With `targetSdkVersion` 35 or higher, `@rnmapbox/maps` uses the `-ndk27` Maps artifacts (16 KB pages). `@rnmapbox/navigation` applies the same rule to the Navigation artifacts, so both use the same Maps and Common artifacts. Keep `targetSdkVersion` in the root project `ext`, where both libraries read it.

### Version pinning

| @rnmapbox/navigation | Navigation SDK | Maps SDK (pinned by Nav) |
| -------------------- | -------------- | ------------------------ |
| 0.1.x                | 3.23.1         | 11.23.1                  |

Navigation SDK 3.N depends on Maps SDK 11.N exactly. On Android, set `RNMapboxMapsVersion` to the matching 11.N. On iOS, `@rnmapbox/maps`' Swift package requirement must allow it.

## Getting started

Request a route, show it on a navigation map, and start simulated guidance:

```tsx
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Mapbox, { Camera, MapView } from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  NavigationViewport,
  type Position,
  type Route,
  type RouteProgressEvent,
} from '@rnmapbox/navigation';

const ACCESS_TOKEN = 'pk....';
Mapbox.setAccessToken(ACCESS_TOKEN);
Navigation.setAccessToken(ACCESS_TOKEN);

const ORIGIN: Position = [-122.39726, 37.79205]; // [longitude, latitude]
const DESTINATION: Position = [-122.39351, 37.79554];

export function NavigationScreen() {
  const [progress, setProgress] = useState<RouteProgressEvent>();

  useEffect(() => {
    const subscription = Navigation.addRouteProgressListener(setProgress);
    let route: Route | undefined;
    let cancelled = false;

    Navigation.requestRoutes({ waypoints: [ORIGIN, DESTINATION] })
      .then(({ main, alternatives }) => {
        alternatives.forEach((alternative) => alternative.release());
        route = main;
        if (cancelled) {
          main.release();
          return;
        }
        // Switches the camera to 'following'.
        return Navigation.startActiveGuidance(main, { simulate: true });
      })
      .catch((error) => console.warn(error));

    return () => {
      cancelled = true;
      subscription.remove();
      Navigation.stopNavigation();
      route?.release();
    };
  }, []);

  return (
    <View style={{ flex: 1 }}>
      <MapView style={{ flex: 1 }} mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>
        <Camera defaultSettings={{ centerCoordinate: ORIGIN, zoomLevel: 14 }} />
        {/* Keeps the puck and the route clear of UI drawn over the map. */}
        <NavigationViewport
          padding={{ top: 16, bottom: 120, left: 16, right: 16 }}
        />
      </MapView>
      {progress && (
        <Text>
          {progress.maneuverInstruction} in{' '}
          {Math.round(progress.stepDistanceRemaining)} m
        </Text>
      )}
    </View>
  );
}
```

`Navigation.previewRoute(route)` shows a route on navigation maps before guidance starts, and `Navigation.setCameraState('overview')` fits the rest of the route.

## API

`Navigation` is the default export and also a named export.

| Function                                     | Description                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------- |
| `setAccessToken(token)`                      | Must be called before any request.                                     |
| `getSdkVersion()`                            | Version of the native Navigation SDK.                                  |
| `requestRoutes(options)`                     | `{ main, alternatives }` routes through `options.waypoints`; also `profile`, `alternatives`, `exclude`, `language`, `units`. |
| `previewRoute(route \| null)`                | Shows a route on navigation maps, or removes it.                       |
| `startActiveGuidance(route, { simulate })`   | Starts guidance along `route`; `simulate` drives it with simulated locations. |
| `stopNavigation()`                           | Stops guidance and clears the maps.                                    |
| `getRouteStats()`                            | Counts of live, released and garbage-collected routes.                 |
| `setCameraState(state)` / `getCameraState()` | `'following'`, `'overview'` or `'idle'`.                               |
| `addCameraStateListener(listener)`           | Camera state changes.                                                  |
| `addRouteProgressListener(listener)`         | Distance, duration and fraction remaining, and the next maneuver's banner. |
| `addLocationListener(listener)`              | Snapped location, road name and speed limit.                           |
| `addArriveListener(listener)`                | Waypoint arrivals.                                                     |
| `addOffRouteListener(listener)`              | Leaving and rejoining the route.                                       |
| `addRouteChangeListener(listener)`           | New `Route` after a reroute or a switch to an alternative.             |
| `addVoiceInstructionListener(listener)`      | Voice instruction text and SSML.                                       |
| `setVoiceMuted(muted)` / `isVoiceMuted()`    | Mutes the SDK's voice instructions.                                    |
| `NAVIGATION_MAP_VIEW_IMPL`                   | `mapViewImpl` value for navigation maps.                               |
| `<NavigationViewport padding />`             | Per-map camera padding.                                                |
| `<NavigationView route \| waypoints />`      | Full-screen navigation UI; see [NavigationView](#navigationview).      |
| `<RNNavigationView route \| waypoints />`    | The same UI in React Native; see [RNNavigationView](#rnnavigationview). |

### Routes

`requestRoutes` resolves to `{ main: Route, alternatives: Route[] }`. A `Route` is a JSI host object backed by the SDK route (`NavigationRoutes` on iOS, `NavigationRoute` on Android):

```ts
interface Route {
  readonly distance: number;           // meters
  readonly expectedTravelTime: number; // seconds
  readonly geometry: LineString;       // GeoJSON, a new object on every read
  readonly legs: RouteLeg[];           // { distance, expectedTravelTime, stepCount, summary, steps }
  readonly isReleased: boolean;
  release(): void;
}
```

- The getters read a copy taken when the route was created. They're synchronous and don't call into the SDK.
- `release()` frees the native route. Calling it again does nothing. Release the routes you don't keep, such as unused alternatives; the garbage collector releases the rest eventually, which can take long because it doesn't see the native memory.
- After `release()`, reading anything but `isReleased` throws an `Error` with `code: 'route_released'`, and `startActiveGuidance` and `previewRoute` reject or throw it.
- Guidance and the preview keep their own reference to the native route until `stopNavigation`. Releasing a route they use is safe and doesn't change them. Releasing can't throw, so a route the GC finalizes mid-guidance behaves the same as one released by hand.
- Each leg's `steps` are `{ instruction, distance, expectedTravelTime, maneuverType, maneuverModifier, name }`.
- `getRouteStats()` returns `{ live, released, collected }` counts, for leak checks.
- Routes don't survive a JS reload.

### Navigation maps

`<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>` is a regular `@rnmapbox/maps` map. Its props, children and events keep working. The Navigation SDK also draws the route line and the puck on it and drives its camera:
- On iOS the map is wrapped in the SDK's `NavigationMapView`.
- On Android the SDK's route line, location puck and `NavigationCamera` are bound to the map.

There's one navigation session per app. Every navigation map shows its route, puck and camera state. Without guidance the maps show the route passed to `previewRoute`.

`<NavigationViewport>` configures the map it's a child of. Its `padding` is in points from the map's edges and ignores the safe area. It applies to `following`, `overview` and the route preview. Without it the SDK defaults apply: the safe area plus a small margin on iOS, and no padding on Android.

### Camera

| State       | Camera                                                                    |
| ----------- | ------------------------------------------------------------------------- |
| `following` | Follows the puck, tilted and rotated with the route. Set by `startActiveGuidance`. |
| `overview`  | Fits the rest of the route.                                               |
| `idle`      | Left alone, for the user's gestures and `@rnmapbox/maps` `Camera`.        |

The state switches to `idle` when:
- a pan, pinch, rotate, pitch or double-tap gesture happens on any navigation map;
- an `@rnmapbox/maps` `Camera` moves the map from its props or `setCamera`. `defaultSettings` doesn't count;
- `stopNavigation` is called.

`addCameraStateListener` reports every change, and `getCameraState` returns the current state. Call `setCameraState('following')` to recenter.
- On Android a `Camera` move with `animationDuration: 0` doesn't switch the state, and the navigation camera takes the map back at the next location update. Animate the move, or call `setCameraState('idle')` first.
- `Camera` `followUserLocation` and the navigation camera both drive the map. Don't combine them.

After `stopNavigation`, the route and the puck are removed and the camera eases back to north-up, without tilt or padding.

### Guidance events

- `addRouteProgressListener`: distances and durations remaining, and the banner of the next maneuver: `maneuverInstruction`, `maneuverType`, `maneuverModifier`, `secondaryInstruction`, `subInstruction`, `lanes` (`{ indications, valid, activeDirection }`, left to right), `legIndex` and `stepIndex`.
- `addLocationListener`: the location snapped to the road or route, with `speed`, `course`, `roadName` and `speedLimit` (`{ speed, unit: 'km/h' | 'mph', sign: 'mutcd' | 'vienna' }`) where known.
- `addArriveListener`: `{ waypointIndex, isFinalDestination }` when a waypoint is reached.
- `addOffRouteListener`: `true` when the user leaves the route, `false` once guidance follows a route again.
- `addRouteChangeListener`: `{ route, reason }` when guidance switches routes on its own, `reason` being `reroute` or `alternative`. `route` is a new `Route`; release it when you're done. The previous route stays valid until released.
- `addVoiceInstructionListener`: `{ text, ssml, distanceAlongStep }` when an instruction is due, for apps doing their own text to speech.

The SDK speaks instructions during any guidance. `setVoiceMuted(true)` mutes it, including in `<NavigationView>`.

### NavigationView

`<NavigationView>` is a full-screen navigation UI: `NavigationViewController` from `MapboxNavigationUIKit` on iOS, and an equivalent built from the Navigation SDK UI components on Android (maneuver banner with lanes and shields, speed limit, trip progress, mute, overview, recenter and end buttons).

```tsx
import { NavigationView } from '@rnmapbox/navigation';

<NavigationView
  style={{ flex: 1 }}
  waypoints={[[-122.39726, 37.79205], { coordinate: [-122.39351, 37.79554], name: 'Ferry Building' }]}
  simulate
  mute={muted}
  onRouteProgress={(event) => console.log(event.distanceRemaining)}
  onArrive={({ waypointIndex, isFinalDestination }) => {}}
  onCancel={() => close()}
  onError={({ code, message }) => {}}
/>
```

| Prop              | Description                                                                         |
| ----------------- | ----------------------------------------------------------------------------------- |
| `route`           | A `Route` from `requestRoutes`. Keep it unreleased while it's passed to the view.   |
| `waypoints`       | Used without `route`: the view requests a route through them and releases it on unmount. |
| `simulate`        | Drives the route with simulated locations. Read when guidance starts.               |
| `mute`            | Mutes voice instructions. The view's own mute button also toggles them.             |
| `onRouteProgress` | Same event as `addRouteProgressListener`.                                           |
| `onArrive`        | `{ waypointIndex, isFinalDestination }`; `waypointIndex` counts the origin as 0.    |
| `onCancel`        | The user ended the trip. Guidance has stopped; unmount the view.                    |
| `onError`         | `{ code, message }`, e.g. `route_request_failed`, `route_released`, `start_failed`. |

It uses the app's single navigation session:
- Mounting it, or giving it a new route, starts guidance along that route and replaces any other active guidance. Navigation maps show its route and puck too.
- Unmounting it, or the user ending the trip, stops guidance.
- `addRouteProgressListener` and `addCameraStateListener` also report its guidance.
- Show one `NavigationView` at a time. On iOS it's embedded as a child of the nearest view controller.

### RNNavigationView

`<RNNavigationView>` is the same kind of navigation UI written in React Native on top of the API above: a navigation map plus a maneuver banner with lanes, a speed limit sign, the road name, ETA and remaining time and distance, mute, overview/recenter and end buttons, and an arrival message. It takes the same props as `<NavigationView>`, plus `styleURL` and `children`, which it renders inside its `MapView`. Use it as is, or copy it as a starting point for your own UI.

## Example app

`example/` (React Native 0.84.1) has a navigation map with route preview, simulated guidance and camera states, a "Route lifecycle" screen with `Route` checks and live counts, a "NavigationView" screen with simulated guidance, and a "RNNavigationView" screen with the React Native UI, simulated or on the device's location, and a log of arrival, off-route, reroute and voice events.

It reads your Mapbox access token from `example/accesstoken` (gitignored), the same way the `@rnmapbox/maps` example does:

```sh
nvm use                                  # Node 22.16.0
echo "pk...." > example/accesstoken
yarn                                     # writes example/env.json from accesstoken

yarn example start
yarn example ios                         # pod install runs automatically
yarn example android
```

## Known limitations

- No explicit offline routing API. Requests use the SDK's default hybrid router, which only falls back to onboard routing with routing tiles already on the device.
- Navigation maps show no alternative routes during guidance.
- Android `<NavigationView>` has no end-of-route, feedback or alternative-route UI, no day/night styles, no road name label, and doesn't show reroutes as such.
- No Expo config plugin.
- `@rnmapbox/maps` `LocationPuck` and `UserLocation` don't work on navigation maps: the navigation puck replaces the map's location provider.
- One navigation session for all navigation maps. Per-map routes or cameras aren't supported.
- Route progress events already on their way to JS still arrive after `stopNavigation`. Ignore them if you need to.
- Not tested yet: live (non-simulated) guidance on a device, release builds, several navigation maps at once, and unmounting a map during guidance.

## Development

```sh
yarn lint
yarn typecheck
yarn test
yarn prepare   # builds lib/ with react-native-builder-bob
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

`@rnmapbox/navigation` is [MIT](LICENSE) licensed.

- The Mapbox Navigation SDKs for iOS and Android it builds on are proprietary. Their use is governed by the [Mapbox Terms of Service](https://www.mapbox.com/legal/tos) and [Navigation SDK pricing](https://www.mapbox.com/pricing#navigation). They're dependencies and aren't redistributed here.
- You need a Mapbox account and access token to use them.
- This is a community-maintained package, not an official Mapbox product.
