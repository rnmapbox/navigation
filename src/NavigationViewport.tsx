import type { ColorValue } from 'react-native';

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
 * Colors of the route lines the Navigation SDK draws on a navigation map. Unset colors keep the SDK defaults.
 *
 * @group Components
 */
export type RouteLineStyle = {
  /** Main route, where traffic is low or unknown. Moderate, heavy and severe traffic keep the SDK's colors. */
  color?: ColorValue;
  /** Border of the main route. */
  casingColor?: ColorValue;
  /** Alternative routes, where traffic is low or unknown. */
  alternativeColor?: ColorValue;
  /** Part of the main route already traveled during guidance. Defaults to transparent, so that part disappears. */
  traveledColor?: ColorValue;
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
  /** Colors of the route line and the alternative routes on this map. */
  routeLineStyle?: RouteLineStyle;
};

/**
 * Configures the navigation camera of the `@rnmapbox/maps` `MapView` it's a child of:
 * `<MapView mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}><NavigationViewport padding={{ bottom: 120 }} /></MapView>`.
 * Without it the SDK defaults apply: the safe area plus a small margin on iOS, no padding on Android.
 *
 * @param props See {@link NavigationViewportProps}.
 * @group Components
 */
export function NavigationViewport({
  padding,
  routeLineStyle,
}: NavigationViewportProps) {
  return (
    <NativeNavigationViewport
      viewportPadding={{
        top: padding?.top ?? 0,
        right: padding?.right ?? 0,
        bottom: padding?.bottom ?? 0,
        left: padding?.left ?? 0,
      }}
      routeLineColor={routeLineStyle?.color}
      routeLineCasingColor={routeLineStyle?.casingColor}
      routeLineAlternativeColor={routeLineStyle?.alternativeColor}
      routeLineTraveledColor={routeLineStyle?.traveledColor}
    />
  );
}
