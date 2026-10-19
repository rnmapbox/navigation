import {
  codegenNativeComponent,
  type CodegenTypes,
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
}

export default codegenNativeComponent<NativeProps>(
  'RNMBXNavigationViewport'
) as HostComponent<NativeProps>;
