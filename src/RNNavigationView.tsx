import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
} from 'react-native';
import { MapView } from '@rnmapbox/maps';

import {
  Navigation,
  NAVIGATION_MAP_VIEW_IMPL,
  type CameraState,
} from './Navigation';
import { NavigationViewport } from './NavigationViewport';
import { useRequestedRoute, type NavigationViewProps } from './NavigationView';
import type { Route } from './Route';
import type {
  Lane,
  LocationEvent,
  RouteProgressEvent,
  SpeedLimit,
} from './specs/NativeRNMBXNavigationModule';
import {
  directionGlyph,
  formatArrival,
  formatDistance,
  formatDuration,
  maneuverGlyph,
} from './guidance';

export type RNNavigationViewProps = NavigationViewProps & {
  /** Defaults to Mapbox Standard. */
  styleURL?: string;
  /** Rendered inside the `MapView`, e.g. extra sources and layers. */
  children?: ReactNode;
};

const MARGIN = 12;

/**
 * `<NavigationView>` built in React Native from the headless API, on an `@rnmapbox/maps` navigation map.
 */
export function RNNavigationView({
  route,
  waypoints,
  simulate = false,
  mute = false,
  styleURL,
  onRouteProgress,
  onArrive,
  onCancel,
  onError,
  style,
  testID,
  children,
}: RNNavigationViewProps) {
  const requested = useRequestedRoute(route ? undefined : waypoints, onError);
  const shown = route ?? requested;

  const [progress, setProgress] = useState<RouteProgressEvent>();
  const [location, setLocation] = useState<LocationEvent>();
  const [cameraState, setCameraState] = useState<CameraState>(
    Navigation.getCameraState
  );
  const [offRoute, setOffRoute] = useState(false);
  const [arrived, setArrived] = useState(false);
  const [ended, setEnded] = useState(false);
  const [muted, setMuted] = useState(mute);
  const [bannerLayout, setBannerLayout] = useState<LayoutRectangle>();
  const [bottomBarHeight, setBottomBarHeight] = useState<number>();

  const props = useRef({ simulate, onRouteProgress, onArrive, onError });
  useEffect(() => {
    props.current = { simulate, onRouteProgress, onArrive, onError };
  });

  useEffect(() => setMuted(mute), [mute]);
  useEffect(() => Navigation.setVoiceMuted(muted), [muted]);

  useEffect(() => {
    const subscriptions = [
      Navigation.addRouteProgressListener((event) => {
        setProgress(event);
        props.current.onRouteProgress?.(event);
      }),
      Navigation.addLocationListener(setLocation),
      Navigation.addCameraStateListener(setCameraState),
      Navigation.addOffRouteListener(setOffRoute),
      Navigation.addArriveListener((event) => {
        setArrived(event.isFinalDestination);
        props.current.onArrive?.(event);
      }),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  useGuidance(shown, ended, props);

  const end = () => {
    setEnded(true);
    Navigation.stopNavigation();
    onCancel?.();
  };

  const viewportPadding =
    bannerLayout && bottomBarHeight !== undefined
      ? {
          top: bannerLayout.y + bannerLayout.height + MARGIN,
          bottom: bottomBarHeight + MARGIN,
          left: MARGIN,
          right: MARGIN,
        }
      : undefined;

  const following = cameraState === 'following';
  const active = progress && !ended;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL={styleURL ?? 'mapbox://styles/mapbox/standard'}
        scaleBarEnabled={false}
        compassEnabled={false}
      >
        <NavigationViewport padding={viewportPadding} />
        {children}
      </MapView>

      {active ? (
        <>
          <View
            style={styles.banner}
            onLayout={(event) => setBannerLayout(event.nativeEvent.layout)}
            testID="rn-navigation-banner"
          >
            <ManeuverBanner progress={progress} offRoute={offRoute} />
          </View>

          <View
            style={[
              styles.side,
              bannerLayout && {
                top: bannerLayout.y + bannerLayout.height + MARGIN,
              },
            ]}
            pointerEvents="box-none"
          >
            <View>
              {location?.speedLimit ? (
                <SpeedLimitSign limit={location.speedLimit} />
              ) : null}
            </View>
            <View style={styles.buttons}>
              <RoundButton
                label={muted ? '🔇' : '🔊'}
                onPress={() => setMuted(!muted)}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                testID="rn-navigation-mute"
              />
              <RoundButton
                label={following ? '⤢' : '➤'}
                onPress={() =>
                  Navigation.setCameraState(
                    following ? 'overview' : 'following'
                  )
                }
                accessibilityLabel={following ? 'Overview' : 'Recenter'}
                testID="rn-navigation-camera"
              />
            </View>
          </View>
        </>
      ) : null}

      <View
        style={styles.bottom}
        pointerEvents="box-none"
        onLayout={(event) =>
          setBottomBarHeight(event.nativeEvent.layout.height)
        }
      >
        {active && location?.roadName ? (
          <Text style={styles.roadName} testID="rn-navigation-road-name">
            {location.roadName}
          </Text>
        ) : null}
        <View style={styles.bottomBar}>
          {arrived ? (
            <Text style={styles.arrived} testID="rn-navigation-arrived">
              You have arrived
            </Text>
          ) : (
            <TripProgress progress={active ? progress : undefined} />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="End navigation"
            onPress={end}
            style={styles.endButton}
            testID="rn-navigation-end"
          >
            <Text style={styles.endButtonText}>✕</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Restarts guidance whenever `route` changes, and stops it when the view unmounts. */
function useGuidance(
  route: Route | undefined,
  ended: boolean,
  props: { current: Pick<RNNavigationViewProps, 'simulate' | 'onError'> }
) {
  useEffect(() => {
    if (!route || ended) {
      return;
    }
    let active = true;
    Navigation.startActiveGuidance(route, {
      simulate: props.current.simulate,
    }).catch((error: Error & { code?: string }) => {
      if (active) {
        props.current.onError?.({
          code: error.code ?? 'start_failed',
          message: error.message,
        });
      }
    });
    return () => {
      active = false;
      Navigation.stopNavigation();
    };
  }, [route, ended, props]);
}

function ManeuverBanner({
  progress,
  offRoute,
}: {
  progress: RouteProgressEvent;
  offRoute: boolean;
}) {
  if (offRoute) {
    return <Text style={styles.instruction}>Rerouting…</Text>;
  }
  return (
    <>
      <View style={styles.maneuverRow}>
        <View style={styles.maneuverIcon}>
          <Text style={styles.maneuverGlyph} testID="rn-navigation-glyph">
            {maneuverGlyph(progress.maneuverType, progress.maneuverModifier)}
          </Text>
          <Text style={styles.maneuverDistance}>
            {formatDistance(progress.stepDistanceRemaining)}
          </Text>
        </View>
        <View style={styles.instructions}>
          <Text
            style={styles.instruction}
            numberOfLines={2}
            testID="rn-navigation-instruction"
          >
            {progress.maneuverInstruction}
          </Text>
          {progress.secondaryInstruction ? (
            <Text style={styles.secondary} numberOfLines={1}>
              {progress.secondaryInstruction}
            </Text>
          ) : null}
        </View>
      </View>
      {progress.lanes.length > 0 ? (
        <Lanes lanes={progress.lanes} />
      ) : progress.subInstruction ? (
        <Text style={styles.sub} numberOfLines={1}>
          Then {progress.subInstruction}
        </Text>
      ) : null}
    </>
  );
}

function Lanes({ lanes }: { lanes: ReadonlyArray<Lane> }) {
  return (
    <View style={styles.lanes} testID="rn-navigation-lanes">
      {lanes.map((lane, index) => (
        <Text
          key={index}
          style={[styles.lane, !lane.valid && styles.laneInvalid]}
        >
          {directionGlyph(lane.activeDirection || lane.indications[0] || '')}
        </Text>
      ))}
    </View>
  );
}

function SpeedLimitSign({ limit }: { limit: SpeedLimit }) {
  const mutcd = limit.sign === 'mutcd';
  return (
    <View
      style={mutcd ? styles.speedLimitMutcd : styles.speedLimitVienna}
      accessibilityLabel={`Speed limit ${limit.speed} ${limit.unit}`}
      testID="rn-navigation-speed-limit"
    >
      {mutcd ? <Text style={styles.speedLimitCaption}>SPEED LIMIT</Text> : null}
      <Text style={styles.speedLimitValue}>{Math.round(limit.speed)}</Text>
    </View>
  );
}

function TripProgress({ progress }: { progress?: RouteProgressEvent }) {
  if (!progress) {
    return <View style={styles.trip} />;
  }
  return (
    <View style={styles.trip} testID="rn-navigation-trip">
      <Text style={styles.arrival}>
        {formatArrival(progress.durationRemaining)}
      </Text>
      <Text style={styles.remaining}>
        {formatDuration(progress.durationRemaining)} ·{' '}
        {formatDistance(progress.distanceRemaining)}
      </Text>
    </View>
  );
}

function RoundButton({
  label,
  onPress,
  accessibilityLabel,
  testID,
}: {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={styles.roundButton}
      testID={testID}
    >
      <Text style={styles.roundButtonText}>{label}</Text>
    </Pressable>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.25,
  shadowRadius: 4,
  shadowOffset: { width: 0, height: 2 },
  elevation: 4,
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: 'absolute',
    top: 56,
    left: MARGIN,
    right: MARGIN,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#14532d',
    ...shadow,
  },
  maneuverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maneuverIcon: { alignItems: 'center', minWidth: 64 },
  maneuverGlyph: { color: 'white', fontSize: 40, fontWeight: '700' },
  maneuverDistance: { color: 'white', fontSize: 15, fontWeight: '600' },
  instructions: { flex: 1 },
  instruction: { color: 'white', fontSize: 20, fontWeight: '700' },
  secondary: { color: '#d1fae5', fontSize: 15, marginTop: 2 },
  sub: {
    color: '#d1fae5',
    fontSize: 15,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#86efac',
  },
  lanes: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#86efac',
  },
  lane: { color: 'white', fontSize: 26, fontWeight: '700', minWidth: 26 },
  laneInvalid: { color: '#4b7a5d' },
  side: {
    position: 'absolute',
    left: MARGIN,
    right: MARGIN,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  buttons: { gap: 10 },
  roundButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  roundButtonText: { fontSize: 22, color: '#111827' },
  speedLimitVienna: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 6,
    borderColor: '#dc2626',
    backgroundColor: 'white',
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  speedLimitMutcd: {
    width: 52,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#111827',
    backgroundColor: 'white',
    alignItems: 'center',
    ...shadow,
  },
  speedLimitCaption: { fontSize: 8, fontWeight: '700', textAlign: 'center' },
  speedLimitValue: { fontSize: 20, fontWeight: '800', color: '#111827' },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  roadName: {
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 34,
    backgroundColor: 'white',
    ...shadow,
  },
  trip: { flex: 1 },
  arrival: { fontSize: 22, fontWeight: '700', color: '#15803d' },
  remaining: { fontSize: 15, color: '#4b5563', marginTop: 2 },
  arrived: { flex: 1, fontSize: 20, fontWeight: '700', color: '#111827' },
  endButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fee2e2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endButtonText: { fontSize: 22, color: '#b91c1c', fontWeight: '700' },
});
