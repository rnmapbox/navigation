import type { ComponentProps } from 'react';
import { Image, type ColorValue } from 'react-native';
import type { LocationPuck } from '@rnmapbox/maps';

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
 * Puck the Navigation SDK draws on a navigation map. The props are the same as `@rnmapbox/maps` `LocationPuck`'s,
 * which doesn't work on navigation maps. The puck always rotates with the course.
 *
 * - `visible`: `false` hides the puck. Defaults to `true`.
 * - `bearingImage`: a 2D puck with this image, by its name in an `@rnmapbox/maps` `Images` on the same map.
 * - `scale`: size of the `bearingImage` puck, a number or a zoom expression.
 * - `model`: a 3D puck with this glTF/glb model. Takes precedence over `bearingImage`.
 *
 * Without `bearingImage` and `model` the SDK's puck shows: 3D on iOS, 2D on Android.
 *
 * @group Components
 */
export type NavigationPuck = Pick<
  ComponentProps<typeof LocationPuck>,
  'visible' | 'bearingImage' | 'scale' | 'model'
>;

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
  /** Puck on this map. Changes apply during guidance too. */
  puck?: NavigationPuck;
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
  puck,
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
      puck={puck && puckToNative(puck)}
    />
  );
}

function puckToNative({ model, ...rest }: NavigationPuck) {
  return model
    ? { ...rest, model: { ...model, uri: modelUri(model.uri) } }
    : rest;
}

function modelUri(uri: string | number): string {
  if (typeof uri === 'string') {
    return uri;
  }
  const asset = Image.resolveAssetSource(uri);
  if (!asset?.uri) {
    throw new Error(
      `NavigationViewport: could not resolve puck model asset: ${uri}`
    );
  }
  // Metro's query string isn't part of the asset's path.
  return asset.uri.split('?')[0]!;
}
