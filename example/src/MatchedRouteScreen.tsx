import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  LineLayer,
  MapView,
  ShapeSource,
  type LineLayerStyle,
} from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  type Position,
  type Route,
} from '@rnmapbox/navigation';

// Along the Embarcadero from the Ferry Building to Pier 39, then Jefferson Street to Hyde Street.
const TOUR: Position[] = [
  [-122.3937, 37.7953],
  [-122.3976, 37.799],
  [-122.3999, 37.802],
  [-122.4033, 37.8047],
  [-122.4064, 37.807],
  [-122.4096, 37.8078],
  [-122.4123, 37.8086],
  [-122.416, 37.808],
  [-122.4203, 37.8074],
];
const PIER_39 = 5;

const TOUR_LINE = {
  type: 'Feature' as const,
  properties: {},
  geometry: { type: 'LineString' as const, coordinates: TOUR },
};

const TOUR_LINE_STYLE: LineLayerStyle = {
  lineColor: '#f97316',
  lineWidth: 2,
  lineDasharray: [2, 2],
};

export default function MatchedRouteScreen({
  onClose,
}: {
  onClose: () => void;
}) {
  const [route, setRoute] = useState<Route>();
  const [navigating, setNavigating] = useState(false);
  const [status, setStatus] = useState('idle');
  const [offRoute, setOffRoute] = useState(false);
  const [arrivals, setArrivals] = useState<string[]>([]);
  const navigatingRef = useRef(false);

  useEffect(() => {
    const progress = Navigation.addRouteProgressListener(
      (event) =>
        navigatingRef.current &&
        setStatus(
          `leg ${event.legIndex + 1} · ${Math.round(event.distanceRemaining)} m left`
        )
    );
    const offRouteSubscription = Navigation.addOffRouteListener(setOffRoute);
    const arrive = Navigation.addArriveListener((event) =>
      setArrivals((list) => [
        ...list,
        `waypoint ${event.waypointIndex}${event.isFinalDestination ? ' (final)' : ''}`,
      ])
    );
    return () => {
      progress.remove();
      offRouteSubscription.remove();
      arrive.remove();
      Navigation.stopNavigation();
    };
  }, []);

  useEffect(() => () => route?.release(), [route]);

  const match = async () => {
    setStatus('matching…');
    try {
      const { main } = await Navigation.requestMatchedRoutes({
        coordinates: TOUR,
        waypointIndices: [0, PIER_39, TOUR.length - 1],
        radiuses: TOUR.map(() => 25),
      });
      Navigation.previewRoute(main);
      setRoute(main);
      setStatus(
        `matched ${Math.round(main.distance)} m in ${main.legs.length} legs`
      );
    } catch (error) {
      const { code, message } = error as Error & { code?: string };
      setStatus(`match failed: ${code ?? ''} ${message}`);
    }
  };

  const start = async () => {
    if (!route) {
      return;
    }
    try {
      navigatingRef.current = true;
      setArrivals([]);
      await Navigation.startActiveGuidance(route, { simulate: true });
      setNavigating(true);
    } catch (error) {
      navigatingRef.current = false;
      setStatus(`start failed: ${(error as Error).message}`);
    }
  };

  const stop = () => {
    navigatingRef.current = false;
    Navigation.stopNavigation();
    setNavigating(false);
    setRoute(undefined);
    setOffRoute(false);
    setStatus('stopped');
  };

  return (
    <View style={styles.screen}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        testID="matched-map"
      >
        <Camera
          defaultSettings={{ centerCoordinate: TOUR[PIER_39], zoomLevel: 13.5 }}
        />
        <ShapeSource id="tour" shape={TOUR_LINE}>
          <LineLayer id="tour-line" style={TOUR_LINE_STYLE} />
        </ShapeSource>
      </MapView>
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.status} testID="matched-status">
          {status}
          {offRoute ? ' · off route' : ''}
        </Text>
        {arrivals.length > 0 ? (
          <Text style={styles.status} testID="matched-arrivals">
            arrived at {arrivals.join(', ')}
          </Text>
        ) : null}
        <View style={styles.buttons}>
          {navigating ? (
            <Button label="Stop" onPress={stop} testID="matched-stop" />
          ) : (
            <>
              <Button label="Match" onPress={match} testID="matched-request" />
              <Button
                label="Simulate"
                onPress={start}
                disabled={!route}
                testID="matched-simulate"
              />
            </>
          )}
          <Button label="Close" onPress={onClose} testID="matched-close" />
        </View>
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 40,
    gap: 8,
    alignItems: 'flex-start',
  },
  status: {
    color: 'white',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 13,
  },
  buttons: { flexDirection: 'row', gap: 8 },
  button: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'white',
    elevation: 3,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111827' },
});
