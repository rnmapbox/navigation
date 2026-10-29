import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutRectangle,
  type StyleProp,
  type TextStyle,
  useColorScheme,
} from 'react-native';
import { MapView, StyleImport } from '@rnmapbox/maps';

import {
  Navigation,
  NAVIGATION_MAP_VIEW_IMPL,
  type CameraState,
} from './Navigation';
import { NavigationViewport, type RouteLineStyle } from './NavigationViewport';
import { useRequestedRoute, type NavigationViewProps } from './NavigationView';
import type { Route } from './Route';
import NativeNavigation, {
  type BannerComponent,
  type Lane,
  type LocationEvent,
  type RouteProgressEvent,
  type SpeedLimit,
} from './specs/NativeRNMBXNavigationModule';
import {
  directionGlyph,
  formatArrival,
  formatDistance,
  formatDuration,
  maneuverGlyph,
  type DistanceUnit,
} from './guidance';

/**
 * `auto` follows the system's dark mode, like `<NavigationView>`.
 *
 * @group Components
 */
export type RNNavigationViewAppearance = 'auto' | 'day' | 'night';

/**
 * Props of {@link RNNavigationView}: {@link NavigationViewProps}, plus the props below.
 *
 * @group Components
 */
export type RNNavigationViewProps = Omit<
  NavigationViewProps,
  'styleURL' | 'nightStyleURL'
> & {
  /** Defaults to Mapbox Standard, whose light preset follows `appearance`. With another style it only changes the UI. */
  styleURL?: string;
  /** Map style while `appearance` is night. Defaults to `styleURL`. */
  nightStyleURL?: string;
  /** Colors of the route line and the alternative routes. */
  routeLineStyle?: RouteLineStyle;
  /**
   * Unit of the distances the view shows, and of voice instructions for a route the view requests through
   * `waypoints`. Defaults to {@link Navigation.getDefaultDistanceUnit}.
   */
  distanceUnit?: DistanceUnit;
  /** Colors of the UI and the Standard style's light preset. Defaults to `auto`. */
  appearance?: RNNavigationViewAppearance;
  /** Rendered inside the `MapView`, e.g. extra sources and layers. */
  children?: ReactNode;
};

const MARGIN = 12;

/**
 * `<NavigationView>` built in React Native from the headless API, on an `@rnmapbox/maps` navigation map: a maneuver
 * banner with road shields, exit numbers and lanes, speed limit, road name, trip progress, mute, overview/recenter and
 * end buttons, and an arrival card. Navigation maps draw the alternative routes of its guidance; tapping one switches
 * to it.
 *
 * It uses the app's single navigation session like `<NavigationView>`. Use it as is, or copy it as a starting point
 * for your own UI.
 *
 * @param props See {@link RNNavigationViewProps}.
 * @group Components
 */
export function RNNavigationView({
  route,
  waypoints,
  simulate = false,
  mute = false,
  styleURL,
  nightStyleURL,
  routeLineStyle,
  distanceUnit: distanceUnitProp,
  appearance = 'auto',
  onRouteProgress,
  onArrive,
  onCancel,
  onError,
  style,
  testID,
  children,
}: RNNavigationViewProps) {
  const colorScheme = useColorScheme();
  const distanceUnit = distanceUnitProp ?? Navigation.getDefaultDistanceUnit();
  const requested = useRequestedRoute(route ? undefined : waypoints, onError, {
    alternatives: true,
    units: distanceUnit,
  });
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
  const night =
    appearance === 'night' || (appearance === 'auto' && colorScheme === 'dark');
  const colors = night ? NIGHT : DAY;
  const mapStyleURL = (night && nightStyleURL) || styleURL;
  const destination = waypoints?.at(-1);
  const destinationName =
    destination && !Array.isArray(destination) ? destination.name : undefined;

  return (
    <View style={[styles.container, style]} testID={testID}>
      <MapView
        style={StyleSheet.absoluteFill}
        mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
        styleURL={mapStyleURL ?? 'mapbox://styles/mapbox/standard'}
        scaleBarEnabled={false}
        compassEnabled={false}
      >
        {mapStyleURL ? null : (
          <StyleImport
            id="basemap"
            existing
            config={{ lightPreset: night ? 'night' : 'day' }}
          />
        )}
        <NavigationViewport
          padding={viewportPadding}
          routeLineStyle={routeLineStyle}
        />
        {children}
      </MapView>

      {active ? (
        <>
          <View
            style={[styles.banner, { backgroundColor: colors.banner }]}
            onLayout={(event) => setBannerLayout(event.nativeEvent.layout)}
            testID="rn-navigation-banner"
          >
            <ManeuverBanner
              progress={progress}
              offRoute={offRoute}
              distanceUnit={distanceUnit}
            />
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
                colors={colors}
                label={muted ? '🔇' : '🔊'}
                onPress={() => setMuted(!muted)}
                accessibilityLabel={muted ? 'Unmute' : 'Mute'}
                testID="rn-navigation-mute"
              />
              <RoundButton
                colors={colors}
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
        {arrived && !ended ? (
          <Arrival
            destinationName={destinationName}
            colors={colors}
            onDone={end}
          />
        ) : (
          <View style={[styles.bottomBar, { backgroundColor: colors.surface }]}>
            <TripProgress
              progress={active ? progress : undefined}
              distanceUnit={distanceUnit}
              colors={colors}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="End navigation"
              onPress={end}
              style={[styles.endButton, { backgroundColor: colors.endButton }]}
              testID="rn-navigation-end"
            >
              <Text style={styles.endButtonText}>✕</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * Restarts guidance whenever `route` changes, and stops it when the view unmounts, back to free drive if guidance
 * started from free drive.
 */
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
      NativeNavigation.stopViewGuidance();
    };
  }, [route, ended, props]);
}

function ManeuverBanner({
  progress,
  offRoute,
  distanceUnit,
}: {
  progress: RouteProgressEvent;
  offRoute: boolean;
  distanceUnit: DistanceUnit;
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
            {formatDistance(progress.stepDistanceRemaining, distanceUnit)}
          </Text>
        </View>
        <View style={styles.instructions}>
          <Instruction
            text={progress.maneuverInstruction}
            components={progress.maneuverComponents}
            modifier={progress.maneuverModifier}
            style={styles.instruction}
            testID="rn-navigation-instruction"
          />
          {progress.secondaryInstruction ? (
            <Instruction
              text={progress.secondaryInstruction}
              components={progress.secondaryComponents}
              modifier={progress.maneuverModifier}
              style={styles.secondary}
            />
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

/** Draws road shields and exit numbers among the text, like the native view's banner. */
function Instruction({
  text,
  components,
  modifier,
  style,
  testID,
}: {
  text: string;
  components: ReadonlyArray<BannerComponent>;
  modifier: string;
  style: StyleProp<TextStyle>;
  testID?: string;
}) {
  if (
    !components.some(({ type }) => type === 'icon' || type === 'exit-number')
  ) {
    return (
      <Text style={style} numberOfLines={2} testID={testID}>
        {text}
      </Text>
    );
  }
  return (
    <View
      style={styles.components}
      accessible
      accessibilityLabel={text}
      testID={testID}
    >
      {components.map((component, index) => {
        switch (component.type) {
          case 'icon':
            return (
              <Shield
                key={`${index}${component.imageUrl}`}
                component={component}
              />
            );
          case 'exit-number':
            return (
              <View key={index} style={styles.exit} testID="rn-navigation-exit">
                <Text style={styles.exitText}>
                  {component.text}{' '}
                  {directionGlyph(
                    modifier.includes('left') ? 'slight left' : 'slight right'
                  )}
                </Text>
              </View>
            );
          case 'exit':
            // Shown as the sign around the exit number.
            return components[index + 1]?.type === 'exit-number' ? null : (
              <Text key={index} style={style}>
                {component.text}
              </Text>
            );
          default:
            return (
              <Text key={index} style={style}>
                {component.text}
              </Text>
            );
        }
      })}
    </View>
  );
}

const SHIELD_HEIGHT = 30;

function Shield({ component }: { component: BannerComponent }) {
  const [aspectRatio, setAspectRatio] = useState<number>();
  const [failed, setFailed] = useState(false);

  if (!component.imageUrl || failed) {
    return (
      <Text style={styles.shieldText} testID="rn-navigation-shield">
        {component.text}
      </Text>
    );
  }
  return (
    <Image
      source={{ uri: component.imageUrl }}
      style={{ height: SHIELD_HEIGHT, aspectRatio: aspectRatio ?? 1 }}
      onLoad={({ nativeEvent: { source } }) =>
        setAspectRatio(source.width / source.height)
      }
      onError={() => setFailed(true)}
      accessibilityLabel={component.text}
      testID="rn-navigation-shield"
    />
  );
}

function Arrival({
  destinationName,
  colors,
  onDone,
}: {
  destinationName?: string;
  colors: Colors;
  onDone: () => void;
}) {
  return (
    <View
      style={[styles.arrivalCard, { backgroundColor: colors.surface }]}
      testID="rn-navigation-arrived"
    >
      <Text style={[styles.arrivalTitle, { color: colors.text }]}>
        You have arrived
      </Text>
      {destinationName ? (
        <Text
          style={[styles.arrivalDestination, { color: colors.secondaryText }]}
          numberOfLines={2}
        >
          {destinationName}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={onDone}
        style={styles.doneButton}
        testID="rn-navigation-done"
      >
        <Text style={styles.doneButtonText}>End navigation</Text>
      </Pressable>
    </View>
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

function TripProgress({
  progress,
  distanceUnit,
  colors,
}: {
  progress?: RouteProgressEvent;
  distanceUnit: DistanceUnit;
  colors: Colors;
}) {
  if (!progress) {
    return <View style={styles.trip} />;
  }
  return (
    <View style={styles.trip} testID="rn-navigation-trip">
      <Text style={[styles.arrival, { color: colors.accent }]}>
        {formatArrival(progress.durationRemaining)}
      </Text>
      <Text style={[styles.remaining, { color: colors.secondaryText }]}>
        {formatDuration(progress.durationRemaining)} ·{' '}
        {formatDistance(progress.distanceRemaining, distanceUnit)}
      </Text>
    </View>
  );
}

function RoundButton({
  colors,
  label,
  onPress,
  accessibilityLabel,
  testID,
}: {
  colors: Colors;
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
      style={[styles.roundButton, { backgroundColor: colors.surface }]}
      testID={testID}
    >
      <Text style={[styles.roundButtonText, { color: colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const DAY = {
  banner: '#14532d',
  surface: 'white',
  text: '#111827',
  secondaryText: '#4b5563',
  accent: '#15803d',
  endButton: '#fee2e2',
};

const NIGHT: Colors = {
  banner: '#052e16',
  surface: '#1f2937',
  text: '#f9fafb',
  secondaryText: '#9ca3af',
  accent: '#4ade80',
  endButton: '#450a0a',
};

type Colors = typeof DAY;

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
    ...shadow,
  },
  maneuverRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  maneuverIcon: { alignItems: 'center', minWidth: 64 },
  maneuverGlyph: { color: 'white', fontSize: 40, fontWeight: '700' },
  maneuverDistance: { color: 'white', fontSize: 15, fontWeight: '600' },
  instructions: { flex: 1 },
  instruction: { color: 'white', fontSize: 20, fontWeight: '700' },
  secondary: { color: '#d1fae5', fontSize: 15, marginTop: 2 },
  components: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
  },
  shieldText: {
    color: '#111827',
    backgroundColor: 'white',
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  exit: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: 'white',
  },
  exitText: { color: 'white', fontSize: 18, fontWeight: '700' },
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
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  roundButtonText: { fontSize: 22 },
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
    ...shadow,
  },
  trip: { flex: 1 },
  arrival: { fontSize: 22, fontWeight: '700' },
  remaining: { fontSize: 15, marginTop: 2 },
  arrivalCard: {
    alignSelf: 'stretch',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 34,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    gap: 6,
    ...shadow,
  },
  arrivalTitle: { fontSize: 24, fontWeight: '700' },
  arrivalDestination: { fontSize: 17 },
  doneButton: {
    marginTop: 12,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#2563eb',
    alignItems: 'center',
  },
  doneButtonText: { color: 'white', fontSize: 17, fontWeight: '700' },
  endButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  endButtonText: { fontSize: 22, color: '#b91c1c', fontWeight: '700' },
});
