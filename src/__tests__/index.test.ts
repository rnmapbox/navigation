import Navigation, {
  type MatchedRouteRequestOptions,
  type Position,
  type Route,
} from '../index';
import NativeNavigation from '../specs/NativeRNMBXNavigationModule';

jest.mock('@rnmapbox/maps', () => ({ MapView: 'MapView' }));

jest.mock('../specs/NativeRNMBXNavigationModule', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn(),
    getSdkVersion: jest.fn(() => '3.33.0'),
    getDefaultDistanceUnit: jest.fn(() => 'imperial'),
    startFreeDrive: jest.fn(() => Promise.resolve()),
    stopNavigation: jest.fn(),
    getSessionState: jest.fn(() => 'freeDrive'),
    onSessionStateChange: jest.fn(() => ({ remove: jest.fn() })),
    setCameraState: jest.fn(),
    getCameraState: jest.fn(() => 'following'),
    onRouteProgress: jest.fn(() => ({ remove: jest.fn() })),
    onCameraStateChange: jest.fn(() => ({ remove: jest.fn() })),
    onOffRouteChange: jest.fn(() => ({ remove: jest.fn() })),
    setVoiceMuted: jest.fn(),
    isVoiceMuted: jest.fn(() => true),
    setVoiceVolume: jest.fn(),
    advanceToNextLeg: jest.fn(),
    setAutoAdvanceLegs: jest.fn(),
    setSimulationSpeed: jest.fn(),
    setRerouteEnabled: jest.fn(),
  },
}));

const native = jest.mocked(NativeNavigation);

const route = { distance: 1000, isReleased: false } as Route;

const bindings = {
  requestRoutes: jest.fn(() =>
    Promise.resolve({ main: route, alternatives: [] })
  ),
  requestMatchedRoutes: jest.fn(() =>
    Promise.resolve({ main: route, alternatives: [] })
  ),
  startActiveGuidance: jest.fn(() => Promise.resolve()),
  previewRoute: jest.fn(),
  getRouteId: jest.fn(() => 1),
  setRouteChangeListener: jest.fn<void, [unknown]>(),
  getRouteStats: jest.fn(() => ({ live: 1, released: 0, collected: 0 })),
};
globalThis.__RNMBXNavigationRoutes = bindings;

describe('Navigation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the native SDK version', () => {
    expect(Navigation.getSdkVersion()).toBe('3.33.0');
    expect(Navigation.getDefaultDistanceUnit()).toBe('imperial');
  });

  it('converts waypoints for requestRoutes', async () => {
    const response = await Navigation.requestRoutes({
      waypoints: [
        [-122.4194, 37.7749],
        { coordinate: [-122.4089, 37.7837], name: 'Ferry Building' },
      ],
      alternatives: true,
    });
    expect(bindings.requestRoutes).toHaveBeenCalledWith({
      waypoints: [
        { longitude: -122.4194, latitude: 37.7749 },
        { longitude: -122.4089, latitude: 37.7837, name: 'Ferry Building' },
      ],
      alternatives: true,
    });
    expect(response.main).toBe(route);
  });

  it('rejects requestRoutes with fewer than two waypoints', async () => {
    await expect(
      Navigation.requestRoutes({ waypoints: [[0, 0]] })
    ).rejects.toThrow(/at least an origin and a destination/);
    expect(bindings.requestRoutes).not.toHaveBeenCalled();
  });

  it('defaults the waypoints of a matched route to the first and last coordinate', async () => {
    const coordinates: Position[] = [
      [-122.3937, 37.7953],
      [-122.3999, 37.802],
      [-122.4096, 37.8078],
    ];
    const response = await Navigation.requestMatchedRoutes({ coordinates });
    expect(bindings.requestMatchedRoutes).toHaveBeenCalledWith({
      coordinates,
      waypointIndices: [0, 2],
    });
    expect(response.main).toBe(route);
  });

  it.each([
    [{ coordinates: [[0, 0]] }, /2 to 100 coordinates, got 1/],
    [
      { coordinates: Array.from({ length: 101 }, (): Position => [0, 0]) },
      /got 101/,
    ],
    [
      {
        coordinates: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        waypointIndices: [0, 1],
      },
      /waypointIndices/,
    ],
    [
      {
        coordinates: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        waypointIndices: [0, 1, 1, 2],
      },
      /waypointIndices/,
    ],
    [
      {
        coordinates: [
          [0, 0],
          [0, 1],
          [0, 2],
        ],
        radiuses: [5, 5],
      },
      /radiuses/,
    ],
    [
      {
        coordinates: [
          [0, 0],
          [0, 1],
        ],
        radiuses: [5, 51],
      },
      /radiuses/,
    ],
  ] as [MatchedRouteRequestOptions, RegExp][])(
    'rejects requestMatchedRoutes beyond the Map Matching limits %#',
    async (options, message) => {
      await expect(Navigation.requestMatchedRoutes(options)).rejects.toThrow(
        message
      );
      expect(bindings.requestMatchedRoutes).not.toHaveBeenCalled();
    }
  );

  it('starts guidance along a route without simulation by default', async () => {
    await Navigation.startActiveGuidance(route);
    expect(bindings.startActiveGuidance).toHaveBeenCalledWith(route, false);
    await Navigation.startActiveGuidance(route, { simulate: true });
    expect(bindings.startActiveGuidance).toHaveBeenLastCalledWith(route, true);
  });

  it('rejects startActiveGuidance when the bindings throw', async () => {
    const released = Object.assign(new Error('Route was released'), {
      code: 'route_released',
    });
    bindings.startActiveGuidance.mockImplementationOnce(() => {
      throw released;
    });
    await expect(Navigation.startActiveGuidance(route)).rejects.toBe(released);
  });

  it('previews a route and clears the preview', () => {
    Navigation.previewRoute(route);
    expect(bindings.previewRoute).toHaveBeenCalledWith(route);
    Navigation.previewRoute(null);
    expect(bindings.previewRoute).toHaveBeenLastCalledWith(null);
  });

  it('subscribes to route progress through the native event emitter', () => {
    const listener = jest.fn();
    const subscription = Navigation.addRouteProgressListener(listener);
    expect(native.onRouteProgress).toHaveBeenCalledWith(listener);
    expect(subscription.remove).toBeDefined();
  });

  it('returns the native camera state', () => {
    expect(Navigation.getCameraState()).toBe('following');
  });

  it('passes the state of camera state events to the listener', () => {
    const listener = jest.fn();
    const subscription = Navigation.addCameraStateListener(listener);
    const nativeListener = native.onCameraStateChange.mock.calls[0]![0];
    nativeListener({ state: 'idle' });
    expect(listener).toHaveBeenCalledWith('idle');
    expect(subscription.remove).toBeDefined();
  });

  it('starts free drive on the device location unless simulated', async () => {
    await Navigation.startFreeDrive();
    expect(native.startFreeDrive).toHaveBeenCalledWith(false, 0, 0, false);
    await Navigation.startFreeDrive({
      simulatedLocation: [-122.4194, 37.7749],
    });
    expect(native.startFreeDrive).toHaveBeenLastCalledWith(
      true,
      -122.4194,
      37.7749,
      false
    );
  });

  it('starts free drive with the foreground service only when asked', async () => {
    await Navigation.startFreeDrive({ foregroundService: true });
    expect(native.startFreeDrive).toHaveBeenLastCalledWith(false, 0, 0, true);
  });

  it('reports the session state', () => {
    expect(Navigation.getSessionState()).toBe('freeDrive');
    const listener = jest.fn();
    Navigation.addSessionStateListener(listener);
    native.onSessionStateChange.mock.calls[0]![0]({ state: 'activeGuidance' });
    expect(listener).toHaveBeenCalledWith('activeGuidance');
  });

  it('passes the off route flag to the listener', () => {
    const listener = jest.fn();
    Navigation.addOffRouteListener(listener);
    native.onOffRouteChange.mock.calls[0]![0]({ offRoute: true });
    expect(listener).toHaveBeenCalledWith(true);
  });

  it('installs the route change listener while JS listens', () => {
    const first = jest.fn();
    const second = jest.fn();
    const firstSubscription = Navigation.addRouteChangeListener(first);
    const secondSubscription = Navigation.addRouteChangeListener(second);
    expect(bindings.setRouteChangeListener).toHaveBeenCalledTimes(1);

    const dispatch = bindings.setRouteChangeListener.mock.calls[0]![0] as (
      event: unknown
    ) => void;
    const event = { route, reason: 'reroute' };
    dispatch(event);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledWith(event);

    firstSubscription.remove();
    firstSubscription.remove();
    expect(bindings.setRouteChangeListener).toHaveBeenCalledTimes(1);
    secondSubscription.remove();
    expect(bindings.setRouteChangeListener).toHaveBeenLastCalledWith(null);
  });

  it('turns rerouting off', () => {
    Navigation.setRerouteEnabled(false);
    expect(native.setRerouteEnabled).toHaveBeenCalledWith(false);
  });

  it('mutes voice instructions', () => {
    Navigation.setVoiceMuted(true);
    expect(native.setVoiceMuted).toHaveBeenCalledWith(true);
    expect(Navigation.isVoiceMuted()).toBe(true);
  });

  it('clamps the voice volume', () => {
    Navigation.setVoiceVolume(0.5);
    expect(native.setVoiceVolume).toHaveBeenLastCalledWith(0.5);
    Navigation.setVoiceVolume(2);
    expect(native.setVoiceVolume).toHaveBeenLastCalledWith(1);
    Navigation.setVoiceVolume(-1);
    expect(native.setVoiceVolume).toHaveBeenLastCalledWith(0);
    expect(() => Navigation.setVoiceVolume(NaN)).toThrow();
    expect(native.setVoiceVolume).toHaveBeenCalledTimes(3);
  });

  it('controls legs', () => {
    Navigation.setAutoAdvanceLegs(false);
    expect(native.setAutoAdvanceLegs).toHaveBeenCalledWith(false);
    Navigation.advanceToNextLeg();
    expect(native.advanceToNextLeg).toHaveBeenCalled();
  });

  it('rejects a non-positive simulation speed', () => {
    Navigation.setSimulationSpeed(4);
    expect(native.setSimulationSpeed).toHaveBeenCalledWith(4);
    expect(() => Navigation.setSimulationSpeed(0)).toThrow();
    expect(() => Navigation.setSimulationSpeed(NaN)).toThrow();
    expect(native.setSimulationSpeed).toHaveBeenCalledTimes(1);
  });
});
