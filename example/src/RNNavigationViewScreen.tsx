import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Navigation, {
  RNNavigationView,
  type DistanceUnit,
  type Position,
  type RNNavigationViewAppearance,
  type Waypoint,
} from '@rnmapbox/navigation';

const APPEARANCES: RNNavigationViewAppearance[] = ['auto', 'day', 'night'];

// Through the city to the Bay Bridge, which has lanes and posted speed limits.
export const TREASURE_ISLAND: Position = [-122.37066, 37.81812];
// Civic Center to Oakland, which has an alternative route.
const CIVIC_CENTER: Position = [-122.4194, 37.7749];
const OAKLAND: Position = [-122.2711, 37.8044];

export default function RNNavigationViewScreen({
  origin,
  destination,
  onClose,
}: {
  origin: Position;
  destination: Position;
  onClose: () => void;
}) {
  const [waypoints, setWaypoints] = useState<Waypoint[]>();
  const [simulate, setSimulate] = useState(true);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>();
  const [appearance, setAppearance] =
    useState<RNNavigationViewAppearance>('auto');

  if (!waypoints) {
    return (
      <View style={styles.setup}>
        <Text style={styles.title}>RNNavigationView</Text>
        <Text style={styles.caption}>
          Pure React Native navigation UI on the headless API.
        </Text>
        <Button
          label={simulate ? 'Simulated location' : 'Device location'}
          onPress={() => setSimulate(!simulate)}
          testID="rn-screen-simulate"
        />
        <Button
          label={`Units: ${distanceUnit ?? 'device'}`}
          onPress={() =>
            setDistanceUnit(
              distanceUnit === undefined
                ? 'metric'
                : distanceUnit === 'metric'
                  ? 'imperial'
                  : undefined
            )
          }
          testID="rn-screen-units"
        />
        <Button
          label={`Appearance: ${appearance}`}
          onPress={() =>
            setAppearance(
              APPEARANCES[
                (APPEARANCES.indexOf(appearance) + 1) % APPEARANCES.length
              ]!
            )
          }
          testID="rn-screen-appearance"
        />
        <Button
          label="Ferry Building"
          onPress={() =>
            setWaypoints([
              origin,
              { coordinate: destination, name: 'Ferry Building' },
            ])
          }
          testID="rn-screen-ferry-building"
        />
        <Button
          label="Treasure Island via Bay Bridge"
          onPress={() =>
            setWaypoints([
              origin,
              { coordinate: TREASURE_ISLAND, name: 'Treasure Island' },
            ])
          }
          testID="rn-screen-treasure-island"
        />
        <Button
          label="Civic Center to Oakland"
          onPress={() =>
            setWaypoints([
              CIVIC_CENTER,
              { coordinate: OAKLAND, name: 'Oakland' },
            ])
          }
          testID="rn-screen-oakland"
        />
        <Button label="Back" onPress={onClose} testID="rn-screen-back" />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <RNNavigationView
        style={StyleSheet.absoluteFill}
        testID="rn-navigation-view"
        waypoints={waypoints}
        simulate={simulate}
        distanceUnit={distanceUnit}
        appearance={appearance}
        onCancel={onClose}
        onError={(error) => console.warn('RNNavigationView', error)}
      />
      <EventLog />
    </View>
  );
}

/** Shows the events the view doesn't render itself, for checking them on a device. */
function EventLog() {
  const [entries, setEntries] = useState<string[]>([]);

  useEffect(() => {
    const log = (entry: string) => {
      console.log(`[RNNavigationViewScreen] ${entry}`);
      setEntries((previous) => [entry, ...previous].slice(0, 5));
    };
    const subscriptions = [
      Navigation.addArriveListener((event) =>
        log(
          `arrive ${event.waypointIndex}${event.isFinalDestination ? ' (final)' : ''}`
        )
      ),
      Navigation.addOffRouteListener((offRoute) => log(`offRoute ${offRoute}`)),
      Navigation.addRouteChangeListener(({ route, reason }) => {
        log(`${reason}: ${Math.round(route.distance)} m`);
        route.release();
      }),
      Navigation.addVoiceInstructionListener((event) =>
        log(`voice: ${event.text}`)
      ),
    ];
    return () => subscriptions.forEach((subscription) => subscription.remove());
  }, []);

  return (
    <View style={styles.log} pointerEvents="none">
      {entries.map((entry, index) => (
        <Text
          key={index}
          style={styles.logEntry}
          numberOfLines={1}
          testID={`rn-screen-log-${index}`}
        >
          {entry}
        </Text>
      ))}
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
  screen: { flex: 1 },
  setup: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    padding: 24,
    gap: 12,
    backgroundColor: '#f3f4f6',
  },
  title: { fontSize: 24, fontWeight: '700', color: '#111827' },
  caption: { fontSize: 15, color: '#4b5563', marginBottom: 12 },
  button: {
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: 'white',
    alignItems: 'center',
    elevation: 2,
  },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#111827' },
  log: { position: 'absolute', left: 12, right: 12, bottom: 150, gap: 4 },
  logEntry: {
    alignSelf: 'flex-start',
    color: 'white',
    backgroundColor: 'rgba(17, 24, 39, 0.75)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    fontSize: 12,
    overflow: 'hidden',
  },
});
