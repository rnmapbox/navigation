# @rnmapbox/navigation

Thin React Native wrapper around the [Mapbox Navigation SDK v3](https://docs.mapbox.com/navigation/) for iOS and Android.
It requests routes, runs an active-guidance session and reports route progress. It renders the route line, the puck and the navigation camera on an [`@rnmapbox/maps`](https://github.com/rnmapbox/maps) `MapView`.

Requires React Native 0.79+ with the New Architecture and `@rnmapbox/maps` 10.3.10+.

> Status: prototype, not published.

## Install

```sh
yarn add @rnmapbox/navigation @rnmapbox/maps
```

Navigation is billed per trip or MAU to the access token you pass, on top of Maps usage. See [Mapbox pricing](https://www.mapbox.com/pricing).

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

Add `NSLocationWhenInUseUsageDescription` to your `Info.plist`.

Podfile options (set them before `use_native_modules!`):

```ruby
# Navigation SDK version, defaults to package.json `mapboxNavigation.ios`. Nav 3.N pins Maps 11.N.
$RNMapboxNavigationVersion = '3.23.1'
# Don't add the Swift package; add mapbox-navigation-ios (product MapboxNavigationCore) yourself.
$RNMapboxNavigationSwiftPackageManager = 'manual'
```

`@rnmapbox/maps`' package requirement comes from `$RNMapboxMapsVersion` (default `~> 11.23.1`), and must be compatible with the Maps version the Navigation SDK pins, otherwise Xcode reports a package resolution error. With a newer Navigation SDK, set `$RNMapboxMapsVersion = '= 11.N.x'` to match.

### Android

Add the Mapbox Maven repository, the same one `@rnmapbox/maps` uses. Release artifacts don't need a downloads token.

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

## Usage

```tsx
import Mapbox, { MapView, Camera } from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  NavigationViewport,
} from '@rnmapbox/navigation';

Mapbox.setAccessToken('pk....');
Navigation.setAccessToken('pk....');

function NavigationScreen() {
  return (
    <MapView style={{ flex: 1 }} mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>
      <Camera defaultSettings={{ centerCoordinate: [-122.397, 37.792], zoomLevel: 14 }} />
      {/* Keeps the puck and the route clear of UI drawn over the map. */}
      <NavigationViewport padding={{ top: 160, bottom: 120, left: 16, right: 16 }} />
    </MapView>
  );
}

const { main, alternatives } = await Navigation.requestRoutes({
  waypoints: [
    [-122.39726, 37.79205], // origin, [longitude, latitude]
    { coordinate: [-122.39351, 37.79554], name: 'Ferry Building' },
  ],
  alternatives: true,
});
alternatives.forEach((route) => route.release());
console.log(main.distance, main.expectedTravelTime, main.legs[0].stepCount);
Navigation.previewRoute(main); // shows it on navigation maps

const progress = Navigation.addRouteProgressListener((event) => {
  console.log(event.maneuverInstruction, event.stepDistanceRemaining, event.fractionTraveled);
});
const camera = Navigation.addCameraStateListener((state) => console.log(state));

await Navigation.startActiveGuidance(main, { simulate: true }); // camera switches to 'following'
Navigation.setCameraState('overview');
// ...
Navigation.stopNavigation();
main.release();
progress.remove();
camera.remove();
```

### Routes

`requestRoutes` resolves to `{ main: Route, alternatives: Route[] }`. A `Route` is a JSI host object backed by the SDK route (`NavigationRoutes` on iOS, `NavigationRoute` on Android):

```ts
interface Route {
  readonly distance: number;           // meters
  readonly expectedTravelTime: number; // seconds
  readonly geometry: LineString;       // GeoJSON, a new object on every read
  readonly legs: RouteLeg[];           // { distance, expectedTravelTime, stepCount, summary }
  readonly isReleased: boolean;
  release(): void;
}
```

- The getters read a copy taken when the route was created. They're synchronous and don't call into the SDK.
- `release()` frees the native route. Calling it again does nothing. Release the routes you don't keep, such as unused alternatives; the garbage collector releases the rest eventually, which can take long because it doesn't see the native memory.
- After `release()`, reading anything but `isReleased` throws an `Error` with `code: 'route_released'`, and `startActiveGuidance` and `previewRoute` reject or throw it.
- Guidance and the preview keep their own reference to the native route until `stopNavigation`. Releasing a route they use is safe and doesn't change them. Releasing can't throw, so a route the GC finalizes mid-guidance behaves the same as one released by hand.
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

### API

| Function                                   | Description                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------- |
| `setAccessToken(token)`                    | Must be called before any request.                                     |
| `getSdkVersion()`                          | Version of the native Navigation SDK.                                  |
| `requestRoutes(options)`                   | `{ main, alternatives }` routes through `options.waypoints`; also `profile`, `alternatives`, `exclude`, `language`, `units`. |
| `previewRoute(route \| null)`              | Shows a route on navigation maps, or removes it.                       |
| `startActiveGuidance(route, { simulate })` | Starts guidance along `route`; `simulate` drives it with simulated locations. |
| `getRouteStats()`                          | Counts of live, released and garbage-collected routes.                |
| `stopNavigation()`                         | Stops guidance and clears the maps.                                    |
| `setCameraState(state)` / `getCameraState()` | `'following'`, `'overview'` or `'idle'`.                             |
| `addCameraStateListener(listener)`         | Camera state changes.                                                  |
| `addRouteProgressListener(listener)`       | Distance, duration and fraction remaining, and the next maneuver.     |
| `NAVIGATION_MAP_VIEW_IMPL`                 | `mapViewImpl` value for navigation maps.                               |
| `<NavigationViewport padding />`           | Per-map camera padding.                                                |

## Limitations

- `@rnmapbox/maps` `LocationPuck` and `UserLocation` don't work on navigation maps: the navigation puck replaces the map's location provider.
- iOS: `@rnmapbox/maps` takes over the map's `gestures.delegate`, so `NavigationMapViewDelegate` interaction callbacks don't fire. Gesture handling for the camera state doesn't depend on them.
- One navigation session for all navigation maps. Per-map routes or cameras aren't supported.
- Route progress events already on their way to JS still arrive after `stopNavigation`. Ignore them if you need to.
- Not tested yet: live (non-simulated) guidance on a device, release builds, several navigation maps at once, and unmounting a map during guidance.
- No voice guidance, rerouting UI, alternatives or multi-leg UI.

## Version pinning

| @rnmapbox/navigation | Navigation SDK | Maps SDK (pinned by Nav) |
| -------------------- | -------------- | ------------------------ |
| 0.1.x                | 3.23.1         | 11.23.1                  |

Navigation SDK 3.N depends on Maps SDK 11.N exactly. On Android, set `RNMapboxMapsVersion` to the matching 11.N. On iOS, `@rnmapbox/maps`' Swift package requirement must allow it.

## Example

| Directory  | React Native | Notes                                                    |
| ---------- | ------------ | -------------------------------------------------------- |
| `example/` | 0.84.1       | navigation map with route preview, simulated guidance and camera states; "Route lifecycle" screen with `Route` checks and live counts |

The example reads your Mapbox access token from `example/accesstoken` (gitignored), the same way the `@rnmapbox/maps` example does:

```sh
nvm use                                  # Node 22.16.0
echo "pk...." > example/accesstoken
yarn                                     # writes example/env.json from accesstoken

yarn example start
yarn example ios                         # pod install runs automatically
yarn example android
```

## Development

```sh
yarn lint
yarn typecheck
yarn test
yarn prepare   # builds lib/ with react-native-builder-bob
```

## License

MIT for this wrapper. The Mapbox Navigation SDK is proprietary and governed by the [Mapbox Terms of Service](https://www.mapbox.com/legal/tos); it's a dependency and isn't redistributed here.
