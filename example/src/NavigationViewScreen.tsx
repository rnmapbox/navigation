import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationView, type Position } from '@rnmapbox/navigation';

import { TREASURE_ISLAND } from './RNNavigationViewScreen';

export default function NavigationViewScreen({
  origin,
  destination,
  onClose,
}: {
  origin: Position;
  destination: Position;
  onClose: () => void;
}) {
  const [mute, setMute] = useState(false);
  const [viaBayBridge, setViaBayBridge] = useState(false);
  const [status, setStatus] = useState('requesting route…');
  const [progressCount, setProgressCount] = useState(0);
  const [arrival, setArrival] = useState('');
  const [arrivalCount, setArrivalCount] = useState(0);

  return (
    <View style={styles.screen}>
      <NavigationView
        style={StyleSheet.absoluteFill}
        testID="navigation-view"
        waypoints={
          viaBayBridge
            ? [origin, { coordinate: TREASURE_ISLAND, name: 'Treasure Island' }]
            : [origin, { coordinate: destination, name: 'Ferry Building' }]
        }
        simulate
        mute={mute}
        onRouteProgress={(event) => {
          setProgressCount((count) => count + 1);
          setStatus(`${Math.round(event.distanceRemaining)} m left`);
        }}
        onArrive={(event) => {
          setArrivalCount((count) => count + 1);
          setArrival(
            `arrived at waypoint ${event.waypointIndex}${
              event.isFinalDestination ? ' (final)' : ''
            }`
          );
        }}
        onCancel={() => {
          setStatus('canceled');
          onClose();
        }}
        onError={(error) => setStatus(`${error.code}: ${error.message}`)}
      />
      <View style={styles.overlay} pointerEvents="box-none">
        <Text style={styles.status} testID="navigation-view-status">
          {status} · {progressCount} updates
        </Text>
        {arrival ? (
          <Text style={styles.status} testID="navigation-view-arrival">
            {arrival} · {arrivalCount} arrival events
          </Text>
        ) : null}
        <View style={styles.buttons}>
          <Button
            label={mute ? 'Unmute' : 'Mute'}
            onPress={() => setMute(!mute)}
            testID="navigation-view-mute"
          />
          <Button
            label={viaBayBridge ? 'Ferry Building' : 'Via Bay Bridge'}
            onPress={() => setViaBayBridge(!viaBayBridge)}
            testID="navigation-view-destination"
          />
          <Button
            label="Close"
            onPress={onClose}
            testID="navigation-view-close"
          />
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
  screen: { flex: 1 },
  overlay: {
    position: 'absolute',
    left: 12,
    top: '45%',
    gap: 8,
    alignItems: 'flex-start',
  },
  status: {
    color: 'white',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    fontSize: 12,
  },
  buttons: { flexDirection: 'row', gap: 8 },
  button: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: 'white',
    elevation: 3,
  },
  buttonText: { fontSize: 13, fontWeight: '600', color: '#111827' },
});
