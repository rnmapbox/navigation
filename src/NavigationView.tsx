import { useEffect, useRef, useState } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import NativeNavigationView from './specs/RNMBXNavigationViewNativeComponent';
import type {
  ArriveEvent,
  RouteProgressEvent,
} from './specs/NativeRNMBXNavigationModule';
import {
  routeBindings,
  toNativeWaypoint,
  type Route,
  type RouteRequestOptions,
  type Waypoint,
} from './Route';

/**
 * Passed to `onError` of {@link NavigationView} and {@link RNNavigationView}.
 *
 * @group Components
 */
export type NavigationViewError = {
  /** E.g. `route_request_failed`, `route_released`, `start_failed`. */
  code: string;
  /** Human-readable, from the SDK where it has one. */
  message: string;
};

/**
 * Props of {@link NavigationView}. Pass either `route` or `waypoints`.
 *
 * @group Components
 */
export type NavigationViewProps = {
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Route from `requestRoutes`. Keep it unreleased while it's passed to the view. */
  route?: Route;
  /**
   * Used when `route` isn't set: the view requests a route through them, origin first, with alternatives, and
   * releases it on unmount.
   */
  waypoints?: Waypoint[];
  /** Drive the route with simulated locations. Read when guidance starts. */
  simulate?: boolean;
  /** Mutes voice instructions. The view's own mute button also toggles them. */
  mute?: boolean;
  /** Map style by day. Defaults to Mapbox Standard. */
  styleURL?: string;
  /**
   * Map style at night, i.e. while the system is in dark mode. Defaults to `styleURL` if that's set, else to Mapbox
   * Standard with its night light preset.
   */
  nightStyleURL?: string;
  /** Same event as {@link Navigation.addRouteProgressListener}. */
  onRouteProgress?: (event: RouteProgressEvent) => void;
  /** Same event as {@link Navigation.addArriveListener}. */
  onArrive?: (event: ArriveEvent) => void;
  /** The user ended the trip; guidance has stopped. Unmount the view. */
  onCancel?: () => void;
  /** The route request or the start of guidance failed. */
  onError?: (error: NavigationViewError) => void;
};

/**
 * Full-screen turn-by-turn navigation UI: `NavigationViewController` from `MapboxNavigationUIKit` on iOS, and an
 * equivalent built from the Navigation SDK UI components on Android.
 *
 * It uses the app's single navigation session: mounting it, or giving it a new route, starts guidance along that route,
 * replacing any active guidance, and unmounting it or the user ending the trip stops guidance. If guidance started from
 * free drive, the session returns to free drive instead. Show one at a time.
 *
 * @param props See {@link NavigationViewProps}.
 * @group Components
 */
export function NavigationView({
  route,
  waypoints,
  simulate = false,
  mute = false,
  styleURL,
  nightStyleURL,
  onRouteProgress,
  onArrive,
  onCancel,
  onError,
  style,
  testID,
}: NavigationViewProps) {
  const requested = useRequestedRoute(route ? undefined : waypoints, onError, {
    alternatives: true,
  });
  const shown = route ?? requested;

  return (
    <NativeNavigationView
      style={style}
      testID={testID}
      routeId={shown ? routeBindings().getRouteId(shown) : 0}
      simulate={simulate}
      mute={mute}
      styleURL={styleURL ?? ''}
      nightStyleURL={nightStyleURL ?? ''}
      onRouteProgress={(event) => onRouteProgress?.(event.nativeEvent)}
      onArrive={(event) => onArrive?.(event.nativeEvent)}
      onCancel={() => onCancel?.()}
      onError={(event) => onError?.(event.nativeEvent)}
    />
  );
}

export function useRequestedRoute(
  waypoints: Waypoint[] | undefined,
  onError: ((error: NavigationViewError) => void) | undefined,
  options: Pick<RouteRequestOptions, 'alternatives' | 'units'> = {}
): Route | undefined {
  const [route, setRoute] = useState<Route>();
  const key = waypoints ? JSON.stringify({ waypoints, ...options }) : undefined;
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!key) {
      return;
    }
    let active = true;
    let requested: Route | undefined;
    const request = JSON.parse(key) as Pick<
      RouteRequestOptions,
      'waypoints' | 'alternatives' | 'units'
    >;
    routeBindings()
      .requestRoutes({
        ...request,
        waypoints: request.waypoints.map(toNativeWaypoint),
      })
      .then(({ main, alternatives }) => {
        // `main` carries its alternatives to guidance.
        alternatives.forEach((alternative) => alternative.release());
        if (!active) {
          main.release();
          return;
        }
        requested = main;
        setRoute(main);
      })
      .catch((error: Error & { code?: string }) => {
        if (active) {
          onErrorRef.current?.({
            code: error.code ?? 'route_request_failed',
            message: error.message,
          });
        }
      });
    // The native view keeps its own reference to a route it started guidance along.
    return () => {
      active = false;
      requested?.release();
      setRoute(undefined);
    };
  }, [key]);

  return route;
}
