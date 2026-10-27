import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type ReactNode,
} from 'react';
import { AppRegistry, StyleSheet } from 'react-native';
import { MapView } from '@rnmapbox/maps';

import NativeNavigation from './specs/NativeRNMBXNavigationModule';

/** Keep in sync with the car map factories in ios/ and android/. */
const CAR_MAP_VIEW_IMPL = 'rnmbxnavcar';

/** Keep in sync with `kModuleName` in ios/RNMBXNavigationCarPlayRoot.mm. */
const CARPLAY_ROOT_MODULE = 'RNMBXNavigationCarPlayRoot';

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

const InCarPlayRoot = createContext(false);

let mountedCarPlayRoots = 0;
const carPlayRootListeners = new Set<() => void>();

function subscribeToCarPlayRoots(listener: () => void) {
  carPlayRootListeners.add(listener);
  return () => {
    carPlayRootListeners.delete(listener);
  };
}

function isCarPlayRootMounted() {
  return mountedCarPlayRoots > 0;
}

function CarPlayRoot({ component: Component }: { component: ComponentType }) {
  useEffect(() => {
    mountedCarPlayRoots += 1;
    carPlayRootListeners.forEach((listener) => listener());
    return () => {
      mountedCarPlayRoots -= 1;
      carPlayRootListeners.forEach((listener) => listener());
    };
  }, []);
  return (
    <InCarPlayRoot.Provider value>
      <Component />
    </InCarPlayRoot.Provider>
  );
}

/** See {@link Navigation.registerCarPlayRoot}. */
export function registerCarPlayRoot(component: ComponentType) {
  AppRegistry.registerComponent(CARPLAY_ROOT_MODULE, () => () => (
    <CarPlayRoot component={component} />
  ));
}

// iOS mounts the root whenever CarPlay connects and the app delegate hands over its factory, registered or not.
AppRegistry.registerComponent(CARPLAY_ROOT_MODULE, () => () => null);

/**
 * Adds its `@rnmapbox/maps` children to the map on the car screen (CarPlay, Android Auto) instead of the phone's.
 * Render it in the component passed to {@link Navigation.registerCarPlayRoot}, and in the app for Android Auto and
 * for iOS apps without a CarPlay root; while a CarPlay root is mounted, only its `<CarMap>` renders.
 * It takes no space on the phone and renders nothing while no car screen shows a map.
 * Views such as `MarkerView` and taps on the map aren't supported on car screens.
 *
 * @param props See {@link CarMapProps}.
 * @group Components
 */
export function CarMap({ children }: CarMapProps) {
  const inCarPlayRoot = useContext(InCarPlayRoot);
  const carPlayRootMounted = useSyncExternalStore(
    subscribeToCarPlayRoots,
    isCarPlayRootMounted
  );
  const [carMap, setCarMap] = useState(NativeNavigation.getCarMap);

  useEffect(() => {
    const subscription = NativeNavigation.onCarMapChange(setCarMap);
    setCarMap(NativeNavigation.getCarMap());
    return () => subscription.remove();
  }, []);

  if (carMap.id === 0 || (!inCarPlayRoot && carPlayRootMounted)) {
    return null;
  }
  const activity: CarMapActivity =
    carMap.activity === 'navigating' ? 'navigating' : 'browsing';
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
