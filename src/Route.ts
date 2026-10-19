import './specs/NativeRNMBXNavigationModule';

/** GeoJSON order, same as `@rnmapbox/maps`. */
export type Position = [longitude: number, latitude: number];

/** GeoJSON LineString. */
export type LineString = { type: 'LineString'; coordinates: Position[] };

export type Waypoint = Position | { coordinate: Position; name?: string };

export type RouteRequestOptions = {
  /** Origin first, destination last. */
  waypoints: Waypoint[];
  /** Mapbox Directions profile. Defaults to `driving-traffic`. */
  profile?: 'driving-traffic' | 'driving' | 'walking' | 'cycling';
  /** Also return alternative routes. Defaults to `false`. */
  alternatives?: boolean;
  /** Road classes to avoid, e.g. `['toll', 'ferry']`. */
  exclude?: string[];
  /** Language of instructions, e.g. `en` or `de-DE`. */
  language?: string;
  units?: 'metric' | 'imperial';
};

export type RouteLeg = {
  /** Meters. */
  distance: number;
  /** Seconds. */
  expectedTravelTime: number;
  stepCount: number;
  /** Names of the main roads, e.g. "Market Street, Embarcadero". */
  summary: string;
};

/**
 * A route from {@link requestRoutes}, backed by the native SDK route.
 *
 * Call `release()` when you're done with it; the garbage collector only releases it eventually. Reading any
 * property but `isReleased` after `release()` throws an error with `code: 'route_released'`.
 * Guidance and the route preview keep their own reference, so releasing a route they use doesn't affect them.
 */
export interface Route {
  /** Meters. */
  readonly distance: number;
  /** Seconds. */
  readonly expectedTravelTime: number;
  /** A new object on every read. */
  readonly geometry: LineString;
  /** A new array on every read. */
  readonly legs: RouteLeg[];
  readonly isReleased: boolean;
  /** Frees the native route. Calling it again does nothing. */
  release(): void;
}

export type RouteResponse = {
  main: Route;
  alternatives: Route[];
};

export type RouteStats = {
  /** Routes JS holds that weren't released yet. */
  live: number;
  /** Routes released with `release()`. */
  released: number;
  /** Routes the garbage collector released. */
  collected: number;
};

type NativeWaypoint = { longitude: number; latitude: number; name?: string };

type RouteBindings = {
  requestRoutes(
    options: Omit<RouteRequestOptions, 'waypoints'> & {
      waypoints: NativeWaypoint[];
    }
  ): Promise<RouteResponse>;
  startActiveGuidance(route: Route, simulate: boolean): Promise<void>;
  previewRoute(route: Route | null): void;
  getRouteStats(): RouteStats;
};

declare global {
  var __RNMBXNavigationRoutes: RouteBindings | undefined;
}

/** Installed when the TurboModule is created, which importing its spec does. */
export function routeBindings(): RouteBindings {
  const bindings = globalThis.__RNMBXNavigationRoutes;
  if (!bindings) {
    throw new Error('@rnmapbox/navigation route bindings are not installed');
  }
  return bindings;
}

export function toNativeWaypoint(waypoint: Waypoint): NativeWaypoint {
  const [longitude, latitude] = Array.isArray(waypoint)
    ? waypoint
    : waypoint.coordinate;
  return Array.isArray(waypoint) || waypoint.name === undefined
    ? { longitude, latitude }
    : { longitude, latitude, name: waypoint.name };
}
