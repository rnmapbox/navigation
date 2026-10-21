import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

export type Lane = {
  /** E.g. `["straight", "right"]`. */
  indications: ReadonlyArray<string>;
  /** The lane can be used to complete the maneuver. */
  valid: boolean;
  /** The indication to follow in this lane, e.g. "right". Empty if unknown or not valid. */
  activeDirection: string;
};

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
  /** Mapbox Directions maneuver type, e.g. "turn", "arrive". Empty if unknown. */
  maneuverType: string;
  /** Mapbox Directions maneuver modifier, e.g. "right", "slight left". Empty if unknown. */
  maneuverModifier: string;
  /** Secondary banner text, e.g. the destination of an exit. Empty if none. */
  secondaryInstruction: string;
  /** Sub banner text, e.g. "Then turn left". Empty if none or if the sub banner shows lanes. */
  subInstruction: string;
  /** Lanes at the next maneuver, left to right. Empty if the route has no lane data there. */
  lanes: ReadonlyArray<Lane>;
  legIndex: CodegenTypes.Int32;
  /** Index of the current step in the current leg. */
  stepIndex: CodegenTypes.Int32;
};

export type SpeedLimit = {
  speed: number;
  /** "km/h" or "mph". */
  unit: string;
  /** "mutcd" (US-style rectangle) or "vienna" (red circle). */
  sign: string;
};

/** The location snapped to the road or the route. */
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

export type ArriveEvent = {
  /** Index in the route's waypoints, origin being 0. */
  waypointIndex: CodegenTypes.Int32;
  isFinalDestination: boolean;
};

export type OffRouteEvent = {
  offRoute: boolean;
};

export type VoiceInstructionEvent = {
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

export interface Spec extends TurboModule {
  setAccessToken(accessToken: string): void;
  getSdkVersion(): string;
  stopNavigation(): void;
  /** One of "following", "overview", "idle". */
  setCameraState(state: string): void;
  /** One of "following", "overview", "idle". */
  getCameraState(): string;
  setVoiceMuted(muted: boolean): void;
  isVoiceMuted(): boolean;

  readonly onRouteProgress: CodegenTypes.EventEmitter<RouteProgressEvent>;
  readonly onCameraStateChange: CodegenTypes.EventEmitter<CameraStateEvent>;
  readonly onLocationChange: CodegenTypes.EventEmitter<LocationEvent>;
  readonly onArrive: CodegenTypes.EventEmitter<ArriveEvent>;
  readonly onOffRouteChange: CodegenTypes.EventEmitter<OffRouteEvent>;
  readonly onVoiceInstruction: CodegenTypes.EventEmitter<VoiceInstructionEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNMBXNavigationModule');
