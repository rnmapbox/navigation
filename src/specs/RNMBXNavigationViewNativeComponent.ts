import {
  codegenNativeComponent,
  type CodegenTypes,
  type HostComponent,
  type ViewProps,
} from 'react-native';

type RouteProgressEvent = Readonly<{
  distanceRemaining: CodegenTypes.Double;
  distanceTraveled: CodegenTypes.Double;
  durationRemaining: CodegenTypes.Double;
  fractionTraveled: CodegenTypes.Double;
  stepDistanceRemaining: CodegenTypes.Double;
  maneuverInstruction: string;
  maneuverType: string;
  maneuverModifier: string;
  secondaryInstruction: string;
  subInstruction: string;
  lanes: {
    indications: string[];
    valid: boolean;
    activeDirection: string;
  }[];
  legIndex: CodegenTypes.Int32;
  stepIndex: CodegenTypes.Int32;
}>;

type ArriveEvent = Readonly<{
  waypointIndex: CodegenTypes.Int32;
  isFinalDestination: boolean;
}>;

type ErrorEvent = Readonly<{
  code: string;
  message: string;
}>;

export interface NativeProps extends ViewProps {
  /** From `getRouteId`; 0 for none. */
  routeId?: CodegenTypes.Double;
  simulate?: boolean;
  mute?: boolean;
  onRouteProgress?: CodegenTypes.DirectEventHandler<RouteProgressEvent>;
  onArrive?: CodegenTypes.DirectEventHandler<ArriveEvent>;
  onCancel?: CodegenTypes.DirectEventHandler<Readonly<{}>>;
  onError?: CodegenTypes.DirectEventHandler<ErrorEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'RNMBXNavigationView'
) as HostComponent<NativeProps>;
