import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { MapView } from '@rnmapbox/maps';

import NativeNavigation from './specs/NativeRNMBXNavigationModule';

/** Keep in sync with the car map factories in ios/ and android/. */
export const CAR_MAP_VIEW_IMPL = 'rnmbxnavcar';

/**
 * What the car screen shows, passed to a {@link CarMap} render function.
 *
 * @group Components
 */
export type CarMapActivity = 'browsing' | 'navigating';

/**
 * Props of {@link CarMap}.
 *
 * @group Components
 */
export type CarMapProps = {
  /** `@rnmapbox/maps` sources, layers and images, or a function of the car screen's activity returning them. */
  children?: ReactNode | ((state: { activity: CarMapActivity }) => ReactNode);
};

/**
 * Adds its `@rnmapbox/maps` children to the map on the car screen (CarPlay, Android Auto) instead of the phone's.
 * Render it anywhere in the app; it takes no space on the phone and renders nothing while no car screen shows a map.
 * Views such as `MarkerView` and taps on the map aren't supported on car screens.
 *
 * @param props See {@link CarMapProps}.
 * @group Components
 */
export function CarMap({ children }: CarMapProps) {
  const [carMap, setCarMap] = useState(NativeNavigation.getCarMap);

  useEffect(() => {
    const subscription = NativeNavigation.onCarMapChange(setCarMap);
    setCarMap(NativeNavigation.getCarMap());
    return () => subscription.remove();
  }, []);

  if (carMap.id === 0) {
    return null;
  }
  const activity = carMap.activity as CarMapActivity;
  // The car screen replaces its map, e.g. when guidance starts; a new key adds the children to the new one.
  return (
    <MapView
      key={carMap.id}
      mapViewImpl={`${CAR_MAP_VIEW_IMPL}:${carMap.id}`}
      style={styles.host}
      pointerEvents="none"
      attributionEnabled={false}
      logoEnabled={false}
      scaleBarEnabled={false}
    >
      {typeof children === 'function' ? children({ activity }) : children}
    </MapView>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', width: 0, height: 0 },
});
