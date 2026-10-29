import type { ComponentType } from 'react';
import type { EventSubscription } from 'react-native';

import { registerCarPlayRoot } from './CarMap';

import NativeNavigation, {
  type ArriveEvent,
  type LocationEvent,
  type RouteProgressEvent,
  type VoiceInstructionEvent,
} from './specs/NativeRNMBXNavigationModule';
import type { DistanceUnit } from './guidance';
import {
  matchedRouteRequestError,
  routeBindings,
  toNativeWaypoint,
  type MatchedRouteRequestOptions,
  type Route,
  type RouteChangeEvent,
  type RouteRequestOptions,
  type RouteResponse,
  type RouteStats,
} from './Route';

/**
 * Options of {@link Navigation.startActiveGuidance}.
 *
 * @group Core
 */
export type StartActiveGuidanceOptions = {
  /** Drive the route with simulated locations instead of the device's location; see {@link Navigation.setSimulationSpeed}. */
  simulate?: boolean;
};

/**
 * Camera of navigation maps. `following` follows the puck, tilted and rotated with the route; `overview` fits the rest
 * of the route; `idle` leaves the map to the user's gestures and `@rnmapbox/maps` `Camera`.
 *
 * @group Core
 */
export type CameraState = 'following' | 'overview' | 'idle';

const routeChangeListeners = new Set<(event: RouteChangeEvent) => void>();

function dispatchRouteChange(event: RouteChangeEvent) {
  routeChangeListeners.forEach((listener) => listener(event));
}

/**
 * The headless navigation API: route requests, the app's single guidance session, and its events.
 * It's also the default export.
 *
 * @group Core
 */
export const Navigation = {
  /** Must be called before any request; navigation is billed to this token. */
  setAccessToken(accessToken: string): void {
    NativeNavigation.setAccessToken(accessToken);
  },

  /** Version of the native Mapbox Navigation SDK linked into the app. */
  getSdkVersion(): string {
    return NativeNavigation.getSdkVersion();
  },

  /** The unit the device's region and measurement settings call for, which the native views use. */
  getDefaultDistanceUnit(): DistanceUnit {
    return NativeNavigation.getDefaultDistanceUnit() as DistanceUnit;
  },

  /**
   * Requests routes through `options.waypoints`. The routes hold native memory: `release()` the ones you don't keep.
   * Rejects with fewer than two waypoints.
   */
  requestRoutes(options: RouteRequestOptions): Promise<RouteResponse> {
    if (options.waypoints.length < 2) {
      return Promise.reject(
        new Error('requestRoutes needs at least an origin and a destination')
      );
    }
    return routeBindings().requestRoutes({
      ...options,
      waypoints: options.waypoints.map(toNativeWaypoint),
    });
  },

  /**
   * Snaps `options.coordinates` to roads with the Mapbox Map Matching API and resolves with a route along them, for
   * guiding a path the app defines, such as a tour or a delivery run. The route works with {@link previewRoute} and
   * {@link startActiveGuidance} like one from {@link requestRoutes}; `alternatives` is always empty. Neither SDK
   * reroutes a matched route: guidance reports going off route and waits for the user to return to it.
   *
   * Rejects without a request if the options break the Map Matching API's limits, and with `code: 'no_single_match'`
   * if the API can only match the coordinates as several disconnected pieces. On Android this uses
   * `requestMapMatching`, which the SDK marks `@ExperimentalPreviewMapboxNavigationAPI`, so it may change in minor
   * releases.
   */
  requestMatchedRoutes(
    options: MatchedRouteRequestOptions
  ): Promise<RouteResponse> {
    const error = matchedRouteRequestError(options);
    if (error) {
      return Promise.reject(new Error(error));
    }
    const last = options.coordinates.length - 1;
    return routeBindings().requestMatchedRoutes({
      ...options,
      waypointIndices: options.waypointIndices ?? [0, last],
    });
  },

  /**
   * Whether guidance requests a new route when the user leaves a route from {@link requestRoutes}. Defaults to `true`.
   * Matched routes from {@link requestMatchedRoutes} are never rerouted.
   *
   * Android applies it at once, also during guidance. iOS reads it only when the navigation session is created, which
   * happens on the first route request or guidance start, so call it before those, e.g. next to
   * {@link setAccessToken}. On iOS a later call that changes the value has no effect and logs a warning.
   */
  setRerouteEnabled(enabled: boolean): void {
    NativeNavigation.setRerouteEnabled(enabled);
  },

  /**
   * Shows `route` on navigation maps until guidance starts or `stopNavigation` is called; `null` removes it.
   * Throws if `route` was released.
   */
  previewRoute(route: Route | null): void {
    routeBindings().previewRoute(route);
  },

  /**
   * Starts active guidance along `route`, replacing any active guidance, and switches the camera to `following`.
   * Rejects if `route` was released. Guidance keeps its own reference to the native route until `stopNavigation`,
   * so `route` can be released at any time.
   */
  startActiveGuidance(
    route: Route,
    options: StartActiveGuidanceOptions = {}
  ): Promise<void> {
    try {
      return routeBindings().startActiveGuidance(
        route,
        options.simulate ?? false
      );
    } catch (error) {
      return Promise.reject(error);
    }
  },

  /**
   * Ends the current leg and guides to the next waypoint, e.g. to skip a stop, or after an arrival with
   * {@link setAutoAdvanceLegs} off. Does nothing on the last leg or without active guidance. Away from the waypoint,
   * guidance reroutes from where it is; simulated guidance jumps to the start of the new leg and reroutes again.
   */
  advanceToNextLeg(): void {
    NativeNavigation.advanceToNextLeg();
  },

  /**
   * Whether guidance moves on to the next leg by itself once it arrives at a waypoint, which is the default. When off,
   * guidance stays at the waypoint, simulated guidance included, until {@link advanceToNextLeg}; arrivals are still
   * reported to {@link addArriveListener}. Turning it on while guidance waits at a waypoint doesn't move on; call
   * {@link advanceToNextLeg}.
   */
  setAutoAdvanceLegs(enabled: boolean): void {
    NativeNavigation.setAutoAdvanceLegs(enabled);
  },

  /**
   * Speed of simulated guidance relative to the route's expected speeds, e.g. `2` drives twice as fast; the default
   * is `1`. Applies to the running and later simulations. Simulated locations keep reporting the route's speed, not
   * multiplied. Higher speeds can make guidance go off-route at sharp turns and reroute, and on Android the
   * simulation doesn't follow reroutes. Throws unless `multiplier` is positive.
   */
  setSimulationSpeed(multiplier: number): void {
    if (!(multiplier > 0)) {
      throw new Error('setSimulationSpeed needs a positive multiplier');
    }
    NativeNavigation.setSimulationSpeed(multiplier);
  },

  /** Counts of native routes, for leak checks. */
  getRouteStats(): RouteStats {
    return routeBindings().getRouteStats();
  },

  /**
   * Stops guidance and removes the route from navigation maps. The camera switches to `idle` and eases back to
   * north-up.
   */
  stopNavigation(): void {
    NativeNavigation.stopNavigation();
  },

  /**
   * Camera of every navigation map (`<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>`).
   * `idle` hands the camera back to the user's gestures and `@rnmapbox/maps` `Camera`.
   * Guidance switches it to `following`; a pan, zoom, rotate or pitch gesture on any navigation map
   * switches it to `idle`. Use {@link addCameraStateListener} to follow those changes.
   */
  setCameraState(state: CameraState): void {
    NativeNavigation.setCameraState(state);
  },

  /** The camera state of navigation maps, see {@link setCameraState}. */
  getCameraState(): CameraState {
    return NativeNavigation.getCameraState() as CameraState;
  },

  /** Called whenever the camera state changes, whether from JS, guidance or a map gesture. */
  addCameraStateListener(
    listener: (state: CameraState) => void
  ): EventSubscription {
    return NativeNavigation.onCameraStateChange((event) =>
      listener(event.state as CameraState)
    );
  },

  /**
   * Called as guidance moves along the route, from the headless API and `<NavigationView>` alike. Events already on
   * their way to JS can still arrive after `stopNavigation`.
   */
  addRouteProgressListener(
    listener: (event: RouteProgressEvent) => void
  ): EventSubscription {
    return NativeNavigation.onRouteProgress(listener);
  },

  /** The location snapped to the road or route, with its speed limit and road name. */
  addLocationListener(
    listener: (event: LocationEvent) => void
  ): EventSubscription {
    return NativeNavigation.onLocationChange(listener);
  },

  /** Called when guidance reaches a waypoint, the final destination included. */
  addArriveListener(listener: (event: ArriveEvent) => void): EventSubscription {
    return NativeNavigation.onArrive(listener);
  },

  /** Called with `true` when the user leaves the route, then with `false` once guidance follows a route again. */
  addOffRouteListener(
    listener: (offRoute: boolean) => void
  ): EventSubscription {
    return NativeNavigation.onOffRouteChange((event) =>
      listener(event.offRoute)
    );
  },

  /**
   * Called when guidance switches to another route on its own. Every listener gets the same new `Route`; the previous
   * one stays valid until released.
   */
  addRouteChangeListener(
    listener: (event: RouteChangeEvent) => void
  ): EventSubscription {
    if (routeChangeListeners.size === 0) {
      routeBindings().setRouteChangeListener(dispatchRouteChange);
    }
    routeChangeListeners.add(listener);
    return {
      remove() {
        if (
          routeChangeListeners.delete(listener) &&
          routeChangeListeners.size === 0
        ) {
          routeBindings().setRouteChangeListener(null);
        }
      },
    };
  },

  /** Called when an instruction is due, whether or not the SDK speaks it; for apps doing their own text to speech. */
  addVoiceInstructionListener(
    listener: (event: VoiceInstructionEvent) => void
  ): EventSubscription {
    return NativeNavigation.onVoiceInstruction(listener);
  },

  /** Mutes the SDK's voice instructions for all guidance, including `<NavigationView>`. */
  setVoiceMuted(muted: boolean): void {
    NativeNavigation.setVoiceMuted(muted);
  },

  /** Whether voice instructions are muted, by {@link setVoiceMuted} or `<NavigationView>`'s mute button. */
  isVoiceMuted(): boolean {
    return NativeNavigation.isVoiceMuted();
  },

  /**
   * Volume of the SDK's voice instructions, from 0 to 1, relative to the device's media volume; clamped to that range.
   * Independent of {@link setVoiceMuted}. On iOS, it doesn't apply to instructions spoken by the system voice, which
   * the SDK falls back to when the Mapbox voice is unavailable, e.g. offline. Throws if `volume` is `NaN`.
   */
  setVoiceVolume(volume: number): void {
    if (Number.isNaN(volume)) {
      throw new Error('setVoiceVolume needs a number');
    }
    NativeNavigation.setVoiceVolume(Math.min(Math.max(volume, 0), 1));
  },

  /**
   * Whether active guidance, `<NavigationView>`'s included, keeps the screen on. On by default. When guidance stops, the
   * app's own idle timer or keep screen on setting is restored. Turn it off if the app manages that itself.
   */
  setKeepScreenOn(keepScreenOn: boolean): void {
    NativeNavigation.setKeepScreenOn(keepScreenOn);
  },

  /**
   * Whether a CarPlay screen shows the navigation session; see the `carPlay` option of the Expo config plugin.
   * Always `false` on Android.
   */
  isCarPlayConnected(): boolean {
    return NativeNavigation.isCarPlayConnected();
  },

  /** Called when a CarPlay screen connects or disconnects. */
  addCarPlayConnectionListener(
    listener: (connected: boolean) => void
  ): EventSubscription {
    return NativeNavigation.onCarPlayConnectionChange((event) =>
      listener(event.connected)
    );
  },

  /**
   * Sets the component iOS keeps mounted while CarPlay is connected, in a React root of its own that draws nothing;
   * render {@link CarMap} in it. When CarPlay launches the app without its phone UI, this root starts React Native.
   * Needs the Expo plugin's `carPlayRoot` option (or `RNMBXNavigationCarPlayRoot.reactNativeFactory` set in the app
   * delegate) and React Native 0.79+. Call it in the app's entry file, next to `registerRootComponent`, as CarPlay
   * looks the root up before anything else loads. Android ignores it.
   */
  registerCarPlayRoot(component: ComponentType): void {
    registerCarPlayRoot(component);
  },
};

/**
 * Pass as `mapViewImpl` to an `@rnmapbox/maps` `MapView` to render the route line, the puck and the
 * navigation camera on it: `<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>`.
 *
 * @group Core
 */
export const NAVIGATION_MAP_VIEW_IMPL = 'rnmbxnav';
