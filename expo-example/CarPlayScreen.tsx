import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Camera, MapView } from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  NavigationViewport,
  type Position,
  type Route,
  type RouteProgressEvent,
} from '@rnmapbox/navigation';

// Mapbox HQ (San Francisco) to Union Square, long enough to watch a few maneuvers on CarPlay.
const ORIGIN: Position = [-122.39726, 37.79205];
const DESTINATION: Position = [-122.4075, 37.78794];

/**
 * CarPlay shows the same session as this screen: the map while idle, turn-by-turn guidance while it guides.
 * In the iOS Simulator, open I/O > External Displays > CarPlay.
 */
export default function CarPlayScreen({ onBack }: { onBack: () => void }) {
  const [connected, setConnected] = useState(Navigation.isCarPlayConnected);
  const [progress, setProgress] = useState<RouteProgressEvent>();
  const [status, setStatus] = useState('idle');
  const routeRef = useRef<Route>(undefined);
  // Progress events already in flight when Stop is pressed still arrive afterwards.
  const navigatingRef = useRef(false);

  useEffect(() => {
    const subscriptions = [
      Navigation.addCarPlayConnectionListener(setConnected),
      Navigation.addRouteProgressListener(
        (event) => navigatingRef.current && setProgress(event)
      ),
    ];
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      stop();
    };
  }, []);

  const stop = () => {
    navigatingRef.current = false;
    Navigation.stopNavigation();
    routeRef.current?.release();
    routeRef.current = undefined;
    setProgress(undefined);
    setStatus('idle');
  };

  const start = async () => {
    try {
      setStatus('requesting route…');
      const { main, alternatives } = await Navigation.requestRoutes({
        waypoints: [ORIGIN, DESTINATION],
      });
      alternatives.forEach((alternative) => alternative.release());
      routeRef.current = main;
      navigatingRef.current = true;
      await Navigation.startActiveGuidance(main, { simulate: true });
      setStatus('guiding');
    } catch (error) {
      navigatingRef.current = false;
      setStatus(`failed: ${(error as Error).message}`);
    }
  };

  return (
    <View style={styles.screen}>
      <MapView
        style={styles.map}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
      >
        <NavigationViewport />
        <Camera defaultSettings={{ centerCoordinate: ORIGIN, zoomLevel: 14 }} />
      </MapView>
      <View style={styles.panel}>
        <Text style={styles.title} testID="carplay-status">
          CarPlay {connected ? 'connected' : 'not connected'}
        </Text>
        {!connected && (
          <Text style={styles.hint}>
            Simulator: I/O › External Displays › CarPlay
          </Text>
        )}
        <Text style={styles.detail} testID="guidance-status">
          {progress?.maneuverInstruction ?? status}
        </Text>
        <View style={styles.buttons}>
          {status === 'guiding' ? (
            <Button label="Stop" onPress={stop} testID="stop" />
          ) : (
            <Button label="Simulate trip" onPress={start} testID="start" />
          )}
          <Button label="Back" onPress={onBack} testID="back" />
        </View>
      </View>
    </View>
  );
}

function Button({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={styles.button}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' },
  map: { flex: 1 },
  panel: { padding: 20, paddingBottom: 40, gap: 8 },
  title: { color: 'white', fontSize: 20, fontWeight: '600' },
  hint: { color: '#9ca3af', fontSize: 14 },
  detail: { color: '#d1d5db', fontSize: 16 },
  buttons: { flexDirection: 'row', gap: 12, marginTop: 8 },
  button: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'white',
  },
  buttonText: { fontSize: 15, fontWeight: '600', color: '#111827' },
});
