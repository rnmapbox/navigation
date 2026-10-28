import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

/**
 * A lane at the next maneuver, in `lanes` of {@link RouteProgressEvent}.
 *
 * @group Events
 */
export type Lane = {
  /** E.g. `["straight", "right"]`. */
  indications: ReadonlyArray<string>;
  /** The lane can be used to complete the maneuver. */
  valid: boolean;
  /** The indication to follow in this lane, e.g. "right". Empty if unknown or not valid. */
  activeDirection: string;
};

/**
 * A piece of a banner instruction, see the Mapbox Directions `banner_instructions` components.
 *
 * @group Events
 */
export type BannerComponent = {
  /** "text", "icon" (a road shield), "delimiter", "exit" or "exit-number". */
  type: string;
  /** For a road shield, its route number, e.g. "I 80". */
  text: string;
  /** PNG of the road shield. Empty if none. */
  imageUrl: string;
};

/**
 * From {@link Navigation.addRouteProgressListener} and `onRouteProgress`.
 *
 * @group Events
 */
export type RouteProgressEvent = {
  /** Meters. */
  distanceRemaining: number;
  /** Meters. */
  distanceTraveled: number;
  /** Seconds. */
  durationRemaining: number;
  /** 0..1 */
  fractionTraveled: number;
  /** Meters to the next maneuver. */
  stepDistanceRemaining: number;
  /** Primary banner text of the next maneuver, e.g. "Turn right onto Market Street". */
  maneuverInstruction: string;
  /** `maneuverInstruction` in pieces, for drawing road shields and exit numbers. */
  maneuverComponents: ReadonlyArray<BannerComponent>;
  /** Mapbox Directions maneuver type, e.g. "turn", "arrive". Empty if unknown. */
  maneuverType: string;
  /** Mapbox Directions maneuver modifier, e.g. "right", "slight left". Empty if unknown. */
  maneuverModifier: string;
  /** Secondary banner text, e.g. the destination of an exit. Empty if none. */
  secondaryInstruction: string;
  /** `secondaryInstruction` in pieces. Empty if none. */
  secondaryComponents: ReadonlyArray<BannerComponent>;
  /** Sub banner text, e.g. "Then turn left". Empty if none or if the sub banner shows lanes. */
  subInstruction: string;
  /** Lanes at the next maneuver, left to right. Empty if the route has no lane data there. */
  lanes: ReadonlyArray<Lane>;
  /** Index of the current leg, in {@link Route} `legs`. */
  legIndex: CodegenTypes.Int32;
  /** Index of the current step in the current leg. */
  stepIndex: CodegenTypes.Int32;
};

/**
 * Posted speed limit, in {@link LocationEvent}.
 *
 * @group Events
 */
export type SpeedLimit = {
  /** In `unit`. */
  speed: number;
  /** "km/h" or "mph". */
  unit: string;
  /** "mutcd" (US-style rectangle) or "vienna" (red circle). */
  sign: string;
};

/**
 * The location snapped to the road or the route.
 *
 * @group Events
 */
export type LocationEvent = {
  latitude: number;
  longitude: number;
  /** Meters per second; -1 if unknown. */
  speed: number;
  /** Degrees clockwise from north; -1 if unknown. */
  course: number;
  /** Empty if unknown. */
  roadName: string;
  /** Missing where the road has no known speed limit. */
  speedLimit?: SpeedLimit;
};

/**
 * From {@link Navigation.addArriveListener} and `onArrive`.
 *
 * @group Events
 */
export type ArriveEvent = {
  /** Index in the route's waypoints, origin being 0. */
  waypointIndex: CodegenTypes.Int32;
  /** The waypoint is the route's last one. */
  isFinalDestination: boolean;
};

export type OffRouteEvent = {
  offRoute: boolean;
};

/**
 * From {@link Navigation.addVoiceInstructionListener}.
 *
 * @group Events
 */
export type VoiceInstructionEvent = {
  /** Plain text of the instruction, e.g. "In 500 feet, turn right onto Market Street". */
  text: string;
  /** Empty if the route has no SSML. */
  ssml: string;
  /** Meters from the start of the step at which the instruction is announced. */
  distanceAlongStep: number;
};

export type CameraStateEvent = {
  /** One of "following", "overview", "idle". */
  state: string;
};

/**
 * From {@link Navigation.addCarPlayConnectionListener}.
 *
 * @group Events
 */
export type CarPlayConnectionEvent = {
  connected: boolean;
};

/**
 * The car screen's map, see {@link CarMap}.
 *
 * @group Events
 */
export type CarMapEvent = {
  /** Changes whenever the car screen switches to another map; 0 if no car screen shows a map. */
  id: CodegenTypes.Int32;
  /** "browsing" (idle or free drive) or "navigating" (turn-by-turn guidance). */
  activity: string;
};

export interface Spec extends TurboModule {
  setAccessToken(accessToken: string): void;
  getSdkVersion(): string;
  /** "metric" or "imperial". */
  getDefaultDistanceUnit(): string;
  stopNavigation(): void;
  /** One of "following", "overview", "idle". */
  setCameraState(state: string): void;
  /** One of "following", "overview", "idle". */
  getCameraState(): string;
  setVoiceMuted(muted: boolean): void;
  isVoiceMuted(): boolean;
  /** 0..1 */
  setVoiceVolume(volume: number): void;
  advanceToNextLeg(): void;
  setAutoAdvanceLegs(enabled: boolean): void;
  setSimulationSpeed(multiplier: number): void;
  isCarPlayConnected(): boolean;
  getCarMap(): CarMapEvent;

  readonly onRouteProgress: CodegenTypes.EventEmitter<RouteProgressEvent>;
  readonly onCameraStateChange: CodegenTypes.EventEmitter<CameraStateEvent>;
  readonly onLocationChange: CodegenTypes.EventEmitter<LocationEvent>;
  readonly onArrive: CodegenTypes.EventEmitter<ArriveEvent>;
  readonly onOffRouteChange: CodegenTypes.EventEmitter<OffRouteEvent>;
  readonly onVoiceInstruction: CodegenTypes.EventEmitter<VoiceInstructionEvent>;
  readonly onCarPlayConnectionChange: CodegenTypes.EventEmitter<CarPlayConnectionEvent>;
  readonly onCarMapChange: CodegenTypes.EventEmitter<CarMapEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNMBXNavigationModule');
