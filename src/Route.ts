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
 * A coordinate, or a coordinate with options.
 *
 * @group Routes
 */
export type Waypoint =
  | Position
  | {
      coordinate: Position;
      /** Shown by the navigation UI, e.g. on arrival. Ignored on silent waypoints. */
      name?: string;
      /**
       * Pass through without stopping: a silent waypoint doesn't end a leg, so there's no arrival at it.
       * The origin and the destination can't be silent. Defaults to `false`.
       */
      silent?: boolean;
      /**
       * `curb` arrives on the driving side of the road, e.g. the right in right-hand traffic.
       * Defaults to `unrestricted`, either side.
       */
      approach?: 'unrestricted' | 'curb';
    };

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
  /**
   * Locations to avoid, at most 50. Each is snapped to the nearest road, and the route avoids that road segment
   * where it can. `driving` and `driving-traffic` only.
   */
  excludePoints?: Position[];
  /**
   * Vehicle height in meters, 0 to 10. The route avoids roads with a lower height limit. The Directions API assumes
   * 1.6 if unset. `driving` and `driving-traffic` only.
   */
  maxHeight?: number;
  /**
   * Vehicle width in meters, 0 to 10. The route avoids roads with a lower width limit. The Directions API assumes
   * 1.9 if unset. `driving` and `driving-traffic` only.
   */
  maxWidth?: number;
  /**
   * Vehicle weight in metric tons, 0 to 100. The route avoids roads with a lower weight limit. The Directions API
   * assumes 2.5 if unset. `driving` and `driving-traffic` only.
   */
  maxWeight?: number;
  /**
   * Departure time as `YYYY-MM-DDThh:mm`, in the local time at the origin. The route and its travel time take
   * predicted traffic and timed restrictions at that time into account. `driving` and `driving-traffic` only.
   */
  departAt?: string;
  /** Desired arrival time as `YYYY-MM-DDThh:mm`, in the local time at the destination. `driving` only. */
  arriveBy?: string;
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
 * Options of {@link Navigation.requestMatchedRoutes}.
 *
 * @group Routes
 */
export type MatchedRouteRequestOptions = {
  /**
   * The path to follow, 2 to 100 coordinates in order. Each is snapped to the nearest road within its radius, so a
   * sparse trace works.
   */
  coordinates: Position[];
  /** Mapbox Map Matching profile. Defaults to `driving-traffic`. */
  profile?: RouteRequestOptions['profile'];
  /**
   * Indices of the `coordinates` that are waypoints: the route is split into legs there and guidance announces the
   * arrival. Must be ascending and include the first and last index. Defaults to the first and last coordinate.
   */
  waypointIndices?: number[];
  /** Meters each coordinate may be away from the road, one per coordinate, 0 to 50. The API defaults to 5. */
  radiuses?: number[];
  /** Language of instructions, e.g. `en` or `de-DE`. */
  language?: string;
  /** Unit of the distances in voice instructions. */
  units?: 'metric' | 'imperial';
};

/** Limit of the Mapbox Map Matching API. */
const MAX_MATCHED_COORDINATES = 100;

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

type NativeWaypoint = {
  longitude: number;
  latitude: number;
  name?: string;
  silent?: boolean;
  approach?: 'unrestricted' | 'curb';
};

type RouteBindings = {
  requestRoutes(
    options: Omit<RouteRequestOptions, 'waypoints'> & {
      waypoints: NativeWaypoint[];
    }
  ): Promise<RouteResponse>;
  requestMatchedRoutes(
    options: Omit<MatchedRouteRequestOptions, 'waypointIndices'> & {
      waypointIndices: number[];
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
  if (Array.isArray(waypoint)) {
    const [longitude, latitude] = waypoint;
    return { longitude, latitude };
  }
  const { coordinate, ...options } = waypoint;
  const [longitude, latitude] = coordinate;
  return { longitude, latitude, ...options };
}

const DRIVING = ['driving', 'driving-traffic'];
const DIRECTIONS_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** The Directions API ignores some unsupported options, and the iOS SDK drops others, so they fail here instead. */
export function validateRequest(options: RouteRequestOptions): string | null {
  const { waypoints } = options;
  if (waypoints.length < 2) {
    return 'requestRoutes needs at least an origin and a destination';
  }
  const isSilent = (waypoint: Waypoint | undefined) =>
    !!waypoint && !Array.isArray(waypoint) && waypoint.silent === true;
  if (isSilent(waypoints[0]) || isSilent(waypoints[waypoints.length - 1])) {
    return "The origin and the destination can't be silent";
  }
  const profile = options.profile ?? 'driving-traffic';
  const drivingOnly = [
    'excludePoints',
    'maxHeight',
    'maxWidth',
    'maxWeight',
    'departAt',
  ] as const;
  for (const name of drivingOnly) {
    if (options[name] !== undefined && !DRIVING.includes(profile)) {
      return `${name} needs the driving or driving-traffic profile`;
    }
  }
  if (options.arriveBy !== undefined && profile !== 'driving') {
    return 'arriveBy needs the driving profile';
  }
  const ranges = [
    ['maxHeight', 10],
    ['maxWidth', 10],
    ['maxWeight', 100],
  ] as const;
  for (const [name, max] of ranges) {
    const value = options[name];
    if (value !== undefined && !(value >= 0 && value <= max)) {
      return `${name} must be between 0 and ${max}`;
    }
  }
  if ((options.excludePoints?.length ?? 0) > 50) {
    return 'excludePoints can have at most 50 points';
  }
  for (const name of ['departAt', 'arriveBy'] as const) {
    const value = options[name];
    if (value !== undefined && !DIRECTIONS_TIME.test(value)) {
      return `${name} must be formatted as YYYY-MM-DDThh:mm`;
    }
  }
  return null;
}

/** Returns why `options` can't be sent to the Map Matching API, or `undefined` if they can. */
export function matchedRouteRequestError(
  options: MatchedRouteRequestOptions
): string | undefined {
  const count = options.coordinates.length;
  if (count < 2 || count > MAX_MATCHED_COORDINATES) {
    return `requestMatchedRoutes needs 2 to ${MAX_MATCHED_COORDINATES} coordinates, got ${count}`;
  }
  const indices = options.waypointIndices;
  if (
    indices &&
    (indices[0] !== 0 ||
      indices[indices.length - 1] !== count - 1 ||
      indices.some(
        (index, i) =>
          !Number.isInteger(index) || (i > 0 && index <= indices[i - 1]!)
      ))
  ) {
    return 'waypointIndices must be ascending and include the first and last coordinate';
  }
  const radiuses = options.radiuses;
  if (
    radiuses &&
    (radiuses.length !== count ||
      radiuses.some((radius) => !(radius >= 0 && radius <= 50)))
  ) {
    return 'radiuses needs one value from 0 to 50 per coordinate';
  }
  return undefined;
}
