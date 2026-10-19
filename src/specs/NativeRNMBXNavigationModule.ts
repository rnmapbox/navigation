import {
  TurboModuleRegistry,
  type CodegenTypes,
  type TurboModule,
} from 'react-native';

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

  readonly onRouteProgress: CodegenTypes.EventEmitter<RouteProgressEvent>;
  readonly onCameraStateChange: CodegenTypes.EventEmitter<CameraStateEvent>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNMBXNavigationModule');
