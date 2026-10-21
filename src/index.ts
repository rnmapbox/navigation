import type { EventSubscription } from 'react-native';

import NativeNavigation, {
  type RouteProgressEvent,
} from './specs/NativeRNMBXNavigationModule';
import {
  routeBindings,
  toNativeWaypoint,
  type Route,
  type RouteRequestOptions,
  type RouteResponse,
  type RouteStats,
} from './Route';

export type { RouteProgressEvent };
export type {
  LineString,
  Position,
  Route,
  RouteLeg,
  RouteRequestOptions,
  RouteResponse,
  RouteStats,
  Waypoint,
} from './Route';
export {
  NavigationView,
  type ArriveEvent,
  type NavigationViewError,
  type NavigationViewProps,
} from './NavigationView';
export {
  NavigationViewport,
  type NavigationViewportProps,
  type ViewportPadding,
} from './NavigationViewport';

export type StartActiveGuidanceOptions = {
  /** Drive the route with simulated locations instead of the device's location. */
  simulate?: boolean;
};

export type CameraState = 'following' | 'overview' | 'idle';

export const Navigation = {
  /** Must be called before any request; navigation is billed to this token. */
  setAccessToken(accessToken: string): void {
    NativeNavigation.setAccessToken(accessToken);
  },

  /** Version of the native Mapbox Navigation SDK linked into the app. */
  getSdkVersion(): string {
    return NativeNavigation.getSdkVersion();
  },

  /**
   * Requests routes through `options.waypoints`. The routes hold native memory: `release()` the ones you don't keep.
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
   * Starts active guidance along `route`. Throws if `route` was released. Guidance keeps its own reference
   * to the native route until `stopNavigation`, so `route` can be released at any time.
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

  /** Stops guidance and removes the route from navigation maps. */
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

  addRouteProgressListener(
    listener: (event: RouteProgressEvent) => void
  ): EventSubscription {
    return NativeNavigation.onRouteProgress(listener);
  },
};

/**
 * Pass as `mapViewImpl` to an `@rnmapbox/maps` `MapView` to render the route line, the puck and the
 * navigation camera on it: `<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}>`.
 */
export const NAVIGATION_MAP_VIEW_IMPL = 'rnmbxnav';

export default Navigation;
