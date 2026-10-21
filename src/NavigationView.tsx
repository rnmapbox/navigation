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

export type NavigationViewError = {
  /** E.g. `route_request_failed`, `route_released`, `start_failed`. */
  code: string;
  message: string;
};

export type NavigationViewProps = {
  style?: StyleProp<ViewStyle>;
  testID?: string;
  /** Route from `requestRoutes`. Keep it unreleased while it's passed to the view. */
  route?: Route;
  /** Used when `route` isn't set: the view requests a route through them, origin first. */
  waypoints?: Waypoint[];
  /** Drive the route with simulated locations. Read when guidance starts. */
  simulate?: boolean;
  /** Mutes voice instructions. The view's own mute button also toggles them. */
  mute?: boolean;
  onRouteProgress?: (event: RouteProgressEvent) => void;
  onArrive?: (event: ArriveEvent) => void;
  /** The user ended the trip; guidance has stopped. */
  onCancel?: () => void;
  onError?: (error: NavigationViewError) => void;
};

/**
 * Full-screen turn-by-turn navigation UI. Mounting it starts guidance along its route, replacing any active guidance.
 */
export function NavigationView({
  route,
  waypoints,
  simulate = false,
  mute = false,
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
