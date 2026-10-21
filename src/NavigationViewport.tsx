import NativeNavigationViewport from './specs/RNMBXNavigationViewportNativeComponent';

/**
 * Points from the map's edges, ignoring the safe area.
 *
 * @group Components
 */
export type ViewportPadding = {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
};

/**
 * Props of {@link NavigationViewport}.
 *
 * @group Components
 */
export type NavigationViewportProps = {
  /**
   * Area the navigation camera keeps the puck and the route in, e.g. to keep them clear of UI drawn
   * over the map. Applies to `following`, `overview` and the route preview.
   */
  padding?: ViewportPadding;
};

/**
 * Configures the navigation camera of the `@rnmapbox/maps` `MapView` it's a child of:
 * `<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}><NavigationViewport padding={{ bottom: 120 }} /></MapView>`.
 * Without it the SDK defaults apply: the safe area plus a small margin on iOS, no padding on Android.
 *
 * @param props See {@link NavigationViewportProps}.
 * @group Components
 */
export function NavigationViewport({ padding }: NavigationViewportProps) {
  return (
    <NativeNavigationViewport
      viewportPadding={{
        top: padding?.top ?? 0,
        right: padding?.right ?? 0,
        bottom: padding?.bottom ?? 0,
        left: padding?.left ?? 0,
      }}
    />
  );
}
