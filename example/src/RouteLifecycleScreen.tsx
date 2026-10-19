import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Camera, MapView } from '@rnmapbox/maps';
import Navigation, {
  NAVIGATION_MAP_VIEW_IMPL,
  type Position,
  type Route,
  type RouteStats,
} from '@rnmapbox/navigation';

// Mapbox HQ (San Francisco) to the Ferry Building, and a longer trip that has alternatives.
const SHORT: Position[] = [
  [-122.39726, 37.79205],
  [-122.39351, 37.79554],
];
const LONG: Position[] = [
  [-122.4194, 37.7749],
  [-122.2711, 37.8044],
];

declare global {
  // Hermes exposes `gc()` in debug builds.

  var gc: (() => void) | undefined;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function errorCode(fn: () => unknown): string {
  try {
    fn();
    return 'no error';
  } catch (error) {
    const { code, message } = error as { code?: string; message: string };
    return `${code ?? '-'}: ${message}`;
  }
}

/**
 * Reproducer for the `Route` host object lifecycle: getters, release, use after release, release during guidance,
 * unmounting the map during guidance and GC finalization, with live counts of native routes.
 */
export default function RouteLifecycleScreen({
  onClose,
}: {
  onClose: () => void;
}) {
  const [stats, setStats] = useState<RouteStats>(Navigation.getRouteStats);
  const [mapMounted, setMapMounted] = useState(true);
  const [guiding, setGuiding] = useState(false);
  const [progressEvents, setProgressEvents] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const route = useRef<Route | undefined>(undefined);
  const progressCount = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setStats(Navigation.getRouteStats());
      setProgressEvents(progressCount.current);
    }, 250);
    const subscription = Navigation.addRouteProgressListener(() => {
      progressCount.current++;
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
      Navigation.stopNavigation();
      route.current?.release();
    };
  }, []);

  const write = (line: string) => {
    console.log(`[RouteLifecycle] ${line}`);
    setLog((lines) => [...lines, line]);
  };

  const check = (name: string, ok: boolean, detail = '') =>
    write(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);

  const request = async (waypoints = SHORT, alternatives = false) => {
    const response = await Navigation.requestRoutes({
      waypoints,
      alternatives,
    });
    route.current?.release();
    route.current = response.main;
    return response;
  };

  const requestAndShow = async () => {
    const { main, alternatives } = await request(LONG, true);
    write(
      `main ${Math.round(main.distance)} m, ${Math.round(main.expectedTravelTime)} s, ` +
        `${main.geometry.coordinates.length} points, ${main.legs.length} leg(s) "${main.legs[0]?.summary}"; ` +
        `${alternatives.length} alternative(s)`
    );
    alternatives.forEach((alternative) => alternative.release());
    Navigation.previewRoute(main);
  };

  const startGuidance = async () => {
    if (!route.current) {
      write('request a route first');
      return;
    }
    try {
      await Navigation.startActiveGuidance(route.current, { simulate: true });
      setGuiding(true);
      write('guidance started');
    } catch (error) {
      write(`start failed: ${(error as Error).message}`);
    }
  };

  const stopGuidance = () => {
    Navigation.stopNavigation();
    setGuiding(false);
    write('guidance stopped');
  };

  const leak = async (count: number) => {
    for (let i = 0; i < count; i++) {
      // Dropped without release(): only the GC can free these.
      await Navigation.requestRoutes({ waypoints: SHORT });
    }
    write(`requested ${count} routes and dropped them`);
  };

  const collect = async () => {
    if (!globalThis.gc) {
      write('gc() is not available');
      return;
    }
    for (let i = 0; i < 5; i++) {
      globalThis.gc();
      await sleep(50);
    }
    write('ran gc()');
  };

  const runChecks = async () => {
    setRunning(true);
    setLog([]);
    try {
      route.current?.release();
      route.current = undefined;
      const before = Navigation.getRouteStats();
      const { main, alternatives } = await request(LONG, true);
      check(
        'requestRoutes returns host objects',
        typeof main === 'object' && main.isReleased === false,
        `${alternatives.length} alternative(s)`
      );
      check(
        'getters',
        main.distance > 0 &&
          main.expectedTravelTime > 0 &&
          main.geometry.type === 'LineString' &&
          main.geometry.coordinates.length > 1 &&
          main.legs.length === 1 &&
          main.legs[0]!.stepCount > 0,
        `${Math.round(main.distance)} m, ${Math.round(main.expectedTravelTime)} s, ` +
          `${main.geometry.coordinates.length} points, ${main.legs[0]?.stepCount} steps`
      );
      check(
        'live count includes the response',
        Navigation.getRouteStats().live - before.live ===
          1 + alternatives.length
      );
      alternatives.forEach((alternative) => alternative.release());

      const live = Navigation.getRouteStats().live;
      main.release();
      route.current = undefined;
      check(
        'release() frees the native route',
        main.isReleased && Navigation.getRouteStats().live === live - 1
      );
      const distanceError = errorCode(() => main.distance);
      check(
        'getter after release throws',
        distanceError.startsWith('route_released'),
        distanceError
      );
      const released = Navigation.getRouteStats().released;
      main.release();
      check(
        'second release() is a no-op',
        Navigation.getRouteStats().released === released
      );
      const startError = await Navigation.startActiveGuidance(main).then(
        () => 'no error',
        (error) => `${error.code}: ${error.message}`
      );
      check(
        'startActiveGuidance with a released route rejects',
        startError.startsWith('route_released'),
        startError
      );
      const previewError = errorCode(() => Navigation.previewRoute(main));
      check(
        'previewRoute with a released route throws',
        previewError.startsWith('route_released'),
        previewError
      );

      const { main: guided } = await request(SHORT);
      await Navigation.startActiveGuidance(guided, { simulate: true });
      setGuiding(true);
      await sleep(2000);
      guided.release();
      route.current = undefined;
      const afterRelease = progressCount.current;
      await sleep(3000);
      check(
        'release() during guidance keeps guiding',
        guided.isReleased && progressCount.current > afterRelease,
        `${progressCount.current - afterRelease} progress events after release`
      );

      setMapMounted(false);
      const afterUnmount = progressCount.current;
      await sleep(2000);
      setMapMounted(true);
      await sleep(2000);
      check(
        'unmounting the map during guidance',
        progressCount.current > afterUnmount,
        `${progressCount.current - afterUnmount} progress events while unmounted and after remount`
      );
      Navigation.stopNavigation();
      setGuiding(false);

      if (globalThis.gc) {
        const collected = Navigation.getRouteStats().collected;
        await leak(5);
        await collect();
        const now = Navigation.getRouteStats();
        check(
          'GC releases dropped routes',
          now.collected >= collected + 5,
          `collected ${now.collected - collected}`
        );
      } else {
        write('SKIP GC: gc() is not available');
      }
      const final = Navigation.getRouteStats();
      write(
        `done: live ${final.live}, released ${final.released}, collected ${final.collected}`
      );
    } catch (error) {
      write(`FAIL unexpected error: ${(error as Error).message}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.map}>
        {mapMounted ? (
          <MapView
            style={StyleSheet.absoluteFill}
            mapViewImpl={NAVIGATION_MAP_VIEW_IMPL}
            styleURL="mapbox://styles/mapbox/standard"
            scaleBarEnabled={false}
          >
            <Camera
              defaultSettings={{ centerCoordinate: SHORT[0], zoomLevel: 14 }}
            />
          </MapView>
        ) : (
          <Text style={styles.unmounted}>map unmounted</Text>
        )}
      </View>

      <View style={styles.stats} testID="route-stats">
        <Stat label="live" value={stats.live} />
        <Stat label="released" value={stats.released} />
        <Stat label="collected" value={stats.collected} />
        <Stat label="progress" value={progressEvents} />
        <Stat label="guiding" value={guiding ? 'yes' : 'no'} />
      </View>

      <View style={styles.buttons}>
        <Button label="Run checks" onPress={runChecks} disabled={running} />
        <Button label="Request" onPress={requestAndShow} />
        <Button
          label="Release"
          onPress={() => {
            route.current?.release();
            write(`released, isReleased ${route.current?.isReleased}`);
          }}
        />
        <Button
          label="Read"
          onPress={() =>
            write(`distance: ${errorCode(() => route.current?.distance)}`)
          }
        />
        {guiding ? (
          <Button label="Stop" onPress={stopGuidance} />
        ) : (
          <Button label="Guide" onPress={startGuidance} />
        )}
        <Button
          label={mapMounted ? 'Unmount map' : 'Mount map'}
          onPress={() => setMapMounted((mounted) => !mounted)}
        />
        <Button label="Leak 10" onPress={() => leak(10)} />
        <Button label="gc()" onPress={collect} />
        <Button label="Back" onPress={onClose} />
      </View>

      <ScrollView style={styles.log} contentContainerStyle={styles.logContent}>
        {log.map((line, index) => (
          <Text
            key={index}
            style={[
              styles.logLine,
              line.startsWith('PASS') && styles.pass,
              line.startsWith('FAIL') && styles.fail,
            ]}
          >
            {line}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue} testID={`stat-${label}`}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
    >
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827', paddingTop: 50 },
  map: { height: 220, backgroundColor: '#1f2937', justifyContent: 'center' },
  unmounted: { color: '#9ca3af', textAlign: 'center' },
  stats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
  },
  stat: { alignItems: 'center' },
  statValue: { color: 'white', fontSize: 20, fontWeight: '700' },
  statLabel: { color: '#9ca3af', fontSize: 12 },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 8,
  },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'white',
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { fontSize: 14, fontWeight: '600', color: '#111827' },
  log: { flex: 1, marginTop: 8 },
  logContent: { padding: 8 },
  logLine: {
    color: '#e5e7eb',
    fontSize: 12,
    fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }),
  },
  pass: { color: '#4ade80' },
  fail: { color: '#f87171' },
});
