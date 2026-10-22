import './specs/NativeRNMBXNavigationModule';

/**
 * GeoJSON order, same as `@rnmapbox/maps`.
 *
 * @group Routes
 */
export type Position = [longitude: number, latitude: number];

/**
 * GeoJSON LineString.
 *
 * @group Routes
 */
export type LineString = { type: 'LineString'; coordinates: Position[] };

/**
 * A coordinate, or a coordinate with the name the navigation UI shows for it, e.g. on arrival.
 *
 * @group Routes
 */
export type Waypoint = Position | { coordinate: Position; name?: string };

/**
 * Options of {@link Navigation.requestRoutes}.
 *
 * @group Routes
 */
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
  /** Unit of the distances in voice instructions. */
  units?: 'metric' | 'imperial';
};

/**
 * A maneuver and the road up to the next one, in `steps` of {@link RouteLeg}.
 *
 * @group Routes
 */
export type RouteStep = {
  /** E.g. "Turn right onto Market Street". */
  instruction: string;
  /** Meters. */
  distance: number;
  /** Seconds. */
  expectedTravelTime: number;
  /** Mapbox Directions maneuver type, e.g. "turn", "arrive". */
  maneuverType: string;
  /** Mapbox Directions maneuver modifier, e.g. "right". Empty if none. */
  maneuverModifier: string;
  /** Name of the road the step is on. Empty if unnamed. */
  name: string;
};

/**
 * The part of a route between two consecutive waypoints.
 *
 * @group Routes
 */
export type RouteLeg = {
  /** Meters. */
  distance: number;
  /** Seconds. */
  expectedTravelTime: number;
  /** Same as `steps.length`. */
  stepCount: number;
  /** Names of the main roads, e.g. "Market Street, Embarcadero". */
  summary: string;
  steps: RouteStep[];
};

/**
 * A route from {@link Navigation.requestRoutes}, backed by the native SDK route.
 * The getters read a copy taken when the route was created, so they're synchronous.
 * Routes don't survive a JS reload.
 *
 * Call `release()` when you're done with it; the garbage collector only releases it eventually. Reading any
 * property but `isReleased` after `release()` throws an error with `code: 'route_released'`.
 * Guidance and the route preview keep their own reference, so releasing a route they use doesn't affect them.
 *
 * @group Routes
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
  /** Whether `release()` was called. Readable after release. */
  readonly isReleased: boolean;
  /** Frees the native route. Calling it again does nothing. */
  release(): void;
}

/**
 * Result of {@link Navigation.requestRoutes}. `alternatives` is empty unless requested.
 *
 * @group Routes
 */
export type RouteResponse = {
  main: Route;
  alternatives: Route[];
};

/**
 * From {@link Navigation.addRouteChangeListener}.
 *
 * @group Events
 */
export type RouteChangeEvent = {
  /** The route guidance follows now. Release it when you're done with it. */
  route: Route;
  /** `reroute` after going off route, `alternative` when guidance switched to an alternative route. */
  reason: 'reroute' | 'alternative';
};

/**
 * From {@link Navigation.getRouteStats}.
 *
 * @group Routes
 */
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
  /** Native views can't receive host objects as props, so `<NavigationView>` passes this id instead. */
  getRouteId(route: Route): number;
  getRouteStats(): RouteStats;
  setRouteChangeListener(
    listener: ((event: RouteChangeEvent) => void) | null
  ): void;
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
