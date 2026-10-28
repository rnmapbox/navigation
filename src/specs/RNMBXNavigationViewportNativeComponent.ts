import {
  codegenNativeComponent,
  type CodegenTypes,
  type ColorValue,
  type HostComponent,
  type ViewProps,
} from 'react-native';

type Padding = Readonly<{
  top: CodegenTypes.Double;
  right: CodegenTypes.Double;
  bottom: CodegenTypes.Double;
  left: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  viewportPadding?: Padding;
  routeLineColor?: ColorValue;
  routeLineCasingColor?: ColorValue;
  routeLineAlternativeColor?: ColorValue;
  routeLineTraveledColor?: ColorValue;
}

export default codegenNativeComponent<NativeProps>(
  'RNMBXNavigationViewport'
) as HostComponent<NativeProps>;
