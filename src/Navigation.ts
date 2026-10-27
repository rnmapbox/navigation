import type { ComponentType } from 'react';
import { AppRegistry, type EventSubscription } from 'react-native';

import NativeNavigation, {
  type ArriveEvent,
  type LocationEvent,
  type RouteProgressEvent,
  type VoiceInstructionEvent,
} from './specs/NativeRNMBXNavigationModule';
import type { DistanceUnit } from './guidance';
import {
  routeBindings,
  toNativeWaypoint,
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
  /** Drive the route with simulated locations instead of the device's location. */
  simulate?: boolean;
};

/**
 * Camera of navigation maps. `following` follows the puck, tilted and rotated with the route; `overview` fits the rest
 * of the route; `idle` leaves the map to the user's gestures and `@rnmapbox/maps` `Camera`.
 *
 * @group Core
 */
export type CameraState = 'following' | 'overview' | 'idle';

/** Keep in sync with `RNMBXNavigationCarPlayRoot.moduleName` in ios/. */
const CARPLAY_ROOT_MODULE = 'RNMBXNavigationCarPlayRoot';

// iOS mounts this module whenever CarPlay connects, also in apps that never call `registerCarPlayRoot`.
AppRegistry.registerComponent(CARPLAY_ROOT_MODULE, () => () => null);

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
   * Sets the component iOS keeps mounted while CarPlay is connected, in a React root of its own that draws nothing.
   * Render `<CarMap>` there: CarPlay can launch the app without its phone UI, and this root still starts React Native
   * then. Call it in the app's entry file, next to `registerRootComponent`. Android Auto ignores it; render
   * `<CarMap>` in the app there.
   */
  registerCarPlayRoot(component: ComponentType): void {
    AppRegistry.registerComponent(CARPLAY_ROOT_MODULE, () => component);
  },
};

/**
 * Pass as `mapViewImpl` to an `@rnmapbox/maps` `MapView` to render the route line, the puck and the
 * navigation camera on it: `<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>`.
 *
 * @group Core
 */
export const NAVIGATION_MAP_VIEW_IMPL = 'rnmbxnav';
