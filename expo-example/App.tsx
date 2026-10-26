import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type LayoutRectangle,
} from 'react-native';
import Mapbox, {
  Camera,
  CircleLayer,
  MapView,
  ShapeSource,
  type CircleLayerStyle,
} from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  NavigationViewport,
  type CameraState,
  type Position,
  type Route,
  type RouteProgressEvent,
} from '@rnmapbox/navigation';
import type { FeatureCollection } from 'geojson';

import { StatusBar } from 'expo-status-bar';

import CarMapLayers from './CarMapLayers';
import CarPlayScreen from './CarPlayScreen';
import env from './env.json';

// Mapbox HQ (San Francisco) to the Ferry Building.
const ORIGIN: Position = [-122.39726, 37.79205];
const DESTINATION: Position = [-122.39351, 37.79554];

// Drawn with plain @rnmapbox/maps components on the navigation map.
const ENDPOINTS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [ORIGIN, DESTINATION].map((coordinates, index) => ({
    type: 'Feature',
    id: index,
    properties: { kind: index === 0 ? 'origin' : 'destination' },
    geometry: { type: 'Point', coordinates },
  })),
};

const ENDPOINT_STYLE: CircleLayerStyle = {
  circleRadius: 9,
  circleColor: ['match', ['get', 'kind'], 'origin', '#16a34a', '#dc2626'],
  circleStrokeWidth: 3,
  circleStrokeColor: '#ffffff',
};

Mapbox.setAccessToken(env.accessToken);
Navigation.setAccessToken(env.accessToken);

function formatDistance(meters: number) {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(1)} km`
    : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.round(seconds - minutes * 60)} s`;
}

export default function App() {
  const [screen, setScreen] = useState<'navigation' | 'carPlay'>('navigation');
  return (
    <>
      {screen === 'carPlay' ? (
        <CarPlayScreen onBack={() => setScreen('navigation')} />
      ) : (
        <NavigationScreen onOpenCarPlay={() => setScreen('carPlay')} />
      )}
      <CarMapLayers />
    </>
  );
}

function NavigationScreen({ onOpenCarPlay }: { onOpenCarPlay: () => void }) {
  const [route, setRoute] = useState<Route>();
  const [progress, setProgress] = useState<RouteProgressEvent>();
  const [navigating, setNavigating] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>(
    Navigation.getCameraState
  );
  const [status, setStatus] = useState('idle');
  const [mapLayout, setMapLayout] = useState<LayoutRectangle>();
  const [bannerLayout, setBannerLayout] = useState<LayoutRectangle>();
  const [controlsLayout, setControlsLayout] = useState<LayoutRectangle>();
  // Progress events already in flight when Stop is pressed still arrive afterwards.
  const navigatingRef = useRef(false);

  useEffect(() => {
    const progressSubscription = Navigation.addRouteProgressListener(
      (event) => navigatingRef.current && setProgress(event)
    );
    const cameraSubscription =
      Navigation.addCameraStateListener(setCameraState);
    return () => {
      progressSubscription.remove();
      cameraSubscription.remove();
    };
  }, []);

  useEffect(() => () => route?.release(), [route]);

  // Keep the puck and the route clear of the banner and the buttons.
  const margin = 16;
  const viewportPadding =
    mapLayout && bannerLayout && controlsLayout
      ? {
          top: bannerLayout.y + bannerLayout.height + margin,
          bottom: mapLayout.height - controlsLayout.y + margin,
          left: margin,
          right: margin,
        }
      : undefined;

  const requestRoute = async () => {
    setStatus('requesting route…');
    try {
      const { main, alternatives } = await Navigation.requestRoutes({
        waypoints: [ORIGIN, DESTINATION],
      });
      alternatives.forEach((alternative) => alternative.release());
      Navigation.previewRoute(main);
      setRoute(main);
      setStatus('route ready');
    } catch (error) {
      setStatus(`route failed: ${(error as Error).message}`);
    }
  };

  const startGuidance = async () => {
    try {
      if (!route) {
        return;
      }
      navigatingRef.current = true;
      await Navigation.startActiveGuidance(route, { simulate: true });
      setNavigating(true);
      setStatus('simulating');
    } catch (error) {
      navigatingRef.current = false;
      setStatus(`start failed: ${(error as Error).message}`);
    }
  };

  const stopGuidance = () => {
    navigatingRef.current = false;
    Navigation.stopNavigation();
    setNavigating(false);
    setRoute(undefined);
    setProgress(undefined);
    setStatus('stopped');
  };

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <MapView
        style={StyleSheet.absoluteFill}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        testID="map"
        onLayout={(event: LayoutChangeEvent) =>
          setMapLayout(event.nativeEvent.layout)
        }
      >
        <NavigationViewport padding={viewportPadding} />
        <Camera
          defaultSettings={{ centerCoordinate: ORIGIN, zoomLevel: 14.5 }}
        />
        <ShapeSource id="endpoints" shape={ENDPOINTS}>
          <CircleLayer id="endpoints-circle" style={ENDPOINT_STYLE} />
        </ShapeSource>
      </MapView>

      <View
        style={styles.banner}
        pointerEvents="none"
        onLayout={(event) => setBannerLayout(event.nativeEvent.layout)}
      >
        {progress ? (
          <>
            <Text style={styles.maneuver} testID="maneuver">
              {progress.maneuverInstruction || '–'}
            </Text>
            <Text style={styles.maneuverDetail} testID="maneuver-detail">
              in {formatDistance(progress.stepDistanceRemaining)}
              {progress.maneuverType
                ? ` · ${progress.maneuverType} ${progress.maneuverModifier}`
                : ''}
            </Text>
            <Text style={styles.progress} testID="progress">
              {formatDistance(progress.distanceRemaining)} ·{' '}
              {formatDuration(progress.durationRemaining)} left ·{' '}
              {(progress.fractionTraveled * 100).toFixed(0)} %
            </Text>
          </>
        ) : (
          <Text style={styles.maneuver} testID="status">
            {route
              ? `Route ${formatDistance(route.distance)}, ${formatDuration(
                  route.expectedTravelTime
                )}, ${route.legs[0]?.stepCount ?? 0} steps`
              : `Nav SDK ${Navigation.getSdkVersion()} · ${status}`}
          </Text>
        )}
      </View>

      <View
        style={styles.controls}
        onLayout={(event) => setControlsLayout(event.nativeEvent.layout)}
      >
        {!navigating ? (
          <>
            <Chip label="Route" onPress={requestRoute} testID="request-route" />
            <Chip
              label="Simulate"
              onPress={startGuidance}
              disabled={!route}
              testID="start-simulation"
            />
            <Chip label="CarPlay" onPress={onOpenCarPlay} testID="carplay" />
          </>
        ) : (
          <>
            {(['following', 'overview', 'idle'] as const).map((state) => (
              <Chip
                key={state}
                label={state}
                selected={cameraState === state}
                onPress={() => Navigation.setCameraState(state)}
                testID={`camera-${state}`}
              />
            ))}
            <Chip label="Stop" onPress={stopGuidance} testID="stop" />
          </>
        )}
      </View>
    </View>
  );
}

function Chip({
  label,
  onPress,
  disabled,
  selected,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  selected?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      testID={testID}
      style={[
        styles.chip,
        selected && styles.chipSelected,
        disabled && styles.chipDisabled,
      ]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  banner: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.9)',
  },
  maneuver: { color: 'white', fontSize: 18, fontWeight: '600' },
  maneuverDetail: { color: '#d1d5db', fontSize: 15, marginTop: 4 },
  progress: { color: '#9ca3af', fontSize: 13, marginTop: 6 },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  chipSelected: { backgroundColor: '#2563eb' },
  chipDisabled: { opacity: 0.4 },
  chipText: { fontSize: 15, fontWeight: '600', color: '#111827' },
  chipTextSelected: { color: 'white' },
});
