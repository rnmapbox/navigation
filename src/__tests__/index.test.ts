import Navigation, { type Route } from '../index';
import NativeNavigation from '../specs/NativeRNMBXNavigationModule';

jest.mock('../specs/NativeRNMBXNavigationModule', () => ({
  __esModule: true,
  default: {
    setAccessToken: jest.fn(),
    getSdkVersion: jest.fn(() => '3.23.1'),
    stopNavigation: jest.fn(),
    setCameraState: jest.fn(),
    getCameraState: jest.fn(() => 'following'),
    onRouteProgress: jest.fn(() => ({ remove: jest.fn() })),
    onCameraStateChange: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

const native = jest.mocked(NativeNavigation);

const route = { distance: 1000, isReleased: false } as Route;

const bindings = {
  requestRoutes: jest.fn(() =>
    Promise.resolve({ main: route, alternatives: [] })
  ),
  startActiveGuidance: jest.fn(() => Promise.resolve()),
  previewRoute: jest.fn(),
  getRouteId: jest.fn(() => 1),
  getRouteStats: jest.fn(() => ({ live: 1, released: 0, collected: 0 })),
};
globalThis.__RNMBXNavigationRoutes = bindings;

describe('Navigation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the native SDK version', () => {
    expect(Navigation.getSdkVersion()).toBe('3.23.1');
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
});
