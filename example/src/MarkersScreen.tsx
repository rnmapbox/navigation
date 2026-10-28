import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  Camera,
  CircleLayer,
  MapView,
  MarkerView,
  PointAnnotation,
  ShapeSource,
  type CircleLayerStyle,
} from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  NavigationViewport,
  type CameraState,
  type LocationEvent,
  type Position,
  type Route,
  type RouteLineStyle,
} from '@rnmapbox/navigation';
import type { Feature, FeatureCollection, Point } from 'geojson';

import { TREASURE_ISLAND } from './RNNavigationViewScreen';

const ROUTE_LINE_STYLE: RouteLineStyle = {
  color: '#7c3aed',
  casingColor: '#4c1d95',
  alternativeColor: '#c4b5fd',
  traveledColor: 'rgba(124, 58, 237, 0.35)',
};

const POI_KINDS = ['Coffee', 'Fuel', 'Parking', 'Charging'] as const;

const POI_STYLE: CircleLayerStyle = {
  circleRadius: 10,
  circleColor: [
    'match',
    ['get', 'kind'],
    'Coffee',
    '#b45309',
    'Fuel',
    '#dc2626',
    'Parking',
    '#2563eb',
    'Charging',
    '#16a34a',
    '#6b7280',
  ],
  circleStrokeWidth: 3,
  circleStrokeColor: '#ffffff',
};

type Poi = { kind: string; name: string };

/** Points of interest spread along the route's geometry. */
function poisAlong(route: Route): FeatureCollection<Point, Poi> {
  const coordinates = route.geometry.coordinates;
  return {
    type: 'FeatureCollection',
    features: POI_KINDS.map((kind, index) => {
      const at = Math.floor(
        ((index + 1) / (POI_KINDS.length + 1)) * (coordinates.length - 1)
      );
      return {
        type: 'Feature',
        id: kind,
        properties: { kind, name: `${kind} #${index + 1}` },
        geometry: { type: 'Point', coordinates: coordinates[at]! },
      };
    }),
  };
}

/**
 * The navigation map is a regular `@rnmapbox/maps` `MapView`: its markers, sources, layers and press events work
 * during guidance, next to the route line, which takes its colors from `routeLineStyle`.
 */
export default function MarkersScreen({
  origin,
  onClose,
}: {
  origin: Position;
  onClose: () => void;
}) {
  const [route, setRoute] = useState<Route>();
  const [navigating, setNavigating] = useState(false);
  const [cameraState, setCameraState] = useState<CameraState>(
    Navigation.getCameraState
  );
  const [selected, setSelected] = useState<Feature<Point, Poi>>();
  const [pins, setPins] = useState<Position[]>([]);
  const [status, setStatus] = useState('requesting route…');
  const location = useRef<LocationEvent>(undefined);

  useEffect(() => {
    let active = true;
    let requested: Route | undefined;
    Navigation.requestRoutes({ waypoints: [origin, TREASURE_ISLAND] })
      .then(({ main, alternatives }) => {
        alternatives.forEach((alternative) => alternative.release());
        if (!active) {
          main.release();
          return;
        }
        requested = main;
        Navigation.previewRoute(main);
        setRoute(main);
        setStatus('tap a point of interest');
      })
      .catch((error: Error) => active && setStatus(error.message));

    const subscriptions = [
      Navigation.addCameraStateListener(setCameraState),
      Navigation.addLocationListener((event) => {
        location.current = event;
      }),
    ];
    return () => {
      active = false;
      subscriptions.forEach((subscription) => subscription.remove());
      Navigation.stopNavigation();
      requested?.release();
    };
  }, [origin]);

  const pois = useMemo(() => (route ? poisAlong(route) : undefined), [route]);

  const start = async () => {
    if (!route) {
      return;
    }
    try {
      await Navigation.startActiveGuidance(route, { simulate: true });
      setNavigating(true);
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const dropPin = () => {
    const current = location.current;
    if (current) {
      setPins((previous) => [
        ...previous,
        [current.longitude, current.latitude],
      ]);
    }
  };

  return (
    <View style={styles.screen}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL="mapbox://styles/mapbox/standard"
        scaleBarEnabled={false}
        testID="markers-map"
      >
        <NavigationViewport
          padding={{ top: 120, bottom: 160, left: 24, right: 72 }}
          routeLineStyle={ROUTE_LINE_STYLE}
        />
        <Camera defaultSettings={{ centerCoordinate: origin, zoomLevel: 13 }} />
        {pois ? (
          <ShapeSource
            id="pois"
            shape={pois}
            onPress={(event) =>
              setSelected(event.features[0] as Feature<Point, Poi>)
            }
          >
            <CircleLayer id="pois-circle" style={POI_STYLE} />
          </ShapeSource>
        ) : null}
        {selected ? (
          <MarkerView
            coordinate={selected.geometry.coordinates}
            anchor={{ x: 0.5, y: 1.4 }}
            allowOverlap
          >
            <Pressable
              onPress={() => setSelected(undefined)}
              style={styles.callout}
              testID="markers-callout"
            >
              <Text style={styles.calloutTitle}>
                {selected.properties.name}
              </Text>
              <Text style={styles.calloutDetail}>Tap to close</Text>
            </Pressable>
          </MarkerView>
        ) : null}
        <PointAnnotation id="destination" coordinate={TREASURE_ISLAND}>
          <View style={styles.flag}>
            <Text style={styles.flagText}>🏁</Text>
          </View>
        </PointAnnotation>
        {pins.map((pin, index) => (
          <PointAnnotation
            key={`pin-${index}`}
            id={`pin-${index}`}
            coordinate={pin}
          >
            <View style={styles.pin} />
          </PointAnnotation>
        ))}
      </MapView>

      <View style={styles.banner} pointerEvents="none">
        <Text style={styles.bannerText} testID="markers-status">
          {status}
        </Text>
      </View>

      <View style={styles.sideControls}>
        <RoundButton
          label={cameraState === 'following' ? '⤢' : '➤'}
          accessibilityLabel={
            cameraState === 'following' ? 'Overview' : 'Follow'
          }
          disabled={!navigating}
          onPress={() =>
            Navigation.setCameraState(
              cameraState === 'following' ? 'overview' : 'following'
            )
          }
          testID="markers-camera"
        />
        <RoundButton
          label="📍"
          accessibilityLabel="Drop a pin here"
          disabled={!navigating}
          onPress={dropPin}
          testID="markers-drop-pin"
        />
      </View>

      <View style={styles.controls}>
        {navigating ? (
          <Chip
            label="Stop"
            onPress={() => {
              Navigation.stopNavigation();
              setNavigating(false);
            }}
            testID="markers-stop"
          />
        ) : (
          <Chip
            label="Simulate"
            onPress={start}
            disabled={!route}
            testID="markers-start"
          />
        )}
        <Chip label="Back" onPress={onClose} testID="markers-back" />
      </View>
    </View>
  );
}

function RoundButton({
  label,
  accessibilityLabel,
  disabled,
  onPress,
  testID,
}: {
  label: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[styles.roundButton, disabled && styles.disabled]}
    >
      <Text style={styles.roundButtonText}>{label}</Text>
    </Pressable>
  );
}

function Chip({
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
      style={[styles.chip, disabled && styles.disabled]}
    >
      <Text style={styles.chipText}>{label}</Text>
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
    backgroundColor: 'rgba(76, 29, 149, 0.92)',
  },
  bannerText: { color: 'white', fontSize: 16, fontWeight: '600' },
  sideControls: {
    position: 'absolute',
    right: 12,
    top: '40%',
    gap: 12,
  },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  roundButtonText: { fontSize: 20 },
  controls: {
    position: 'absolute',
    bottom: 40,
    left: 12,
    right: 12,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: 'white',
    elevation: 3,
  },
  chipText: { fontSize: 15, fontWeight: '600', color: '#111827' },
  disabled: { opacity: 0.4 },
  callout: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'white',
    elevation: 4,
  },
  calloutTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  calloutDetail: { fontSize: 12, color: '#6b7280' },
  flag: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  flagText: { fontSize: 20 },
  pin: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: 'white',
    backgroundColor: '#7c3aed',
  },
});
