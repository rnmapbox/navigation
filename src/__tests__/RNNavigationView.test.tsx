import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RNNavigationView } from '../RNNavigationView';
import type { Route } from '../Route';
import NativeNavigation, {
  type RouteProgressEvent,
} from '../specs/NativeRNMBXNavigationModule';

jest.mock('@rnmapbox/maps', () => ({ MapView: 'MapView' }));

jest.mock('../specs/RNMBXNavigationViewportNativeComponent', () => ({
  __esModule: true,
  default: 'RNMBXNavigationViewport',
}));

jest.mock('../specs/NativeRNMBXNavigationModule', () => {
  const emitter = () => jest.fn(() => ({ remove: jest.fn() }));
  return {
    __esModule: true,
    default: {
      stopNavigation: jest.fn(),
      setCameraState: jest.fn(),
      getCameraState: jest.fn(() => 'following'),
      setVoiceMuted: jest.fn(),
      onRouteProgress: emitter(),
      onCameraStateChange: emitter(),
      onLocationChange: emitter(),
      onArrive: emitter(),
      onOffRouteChange: emitter(),
    },
  };
});

const native = jest.mocked(NativeNavigation);

const route = { isReleased: false, release: jest.fn() } as unknown as Route;

const bindings = {
  requestRoutes: jest.fn(),
  startActiveGuidance: jest.fn(() => Promise.resolve()),
  previewRoute: jest.fn(),
  getRouteId: jest.fn(),
  setRouteChangeListener: jest.fn(),
  getRouteStats: jest.fn(),
};
globalThis.__RNMBXNavigationRoutes = bindings;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const progress: RouteProgressEvent = {
  distanceRemaining: 2400,
  distanceTraveled: 100,
  durationRemaining: 300,
  fractionTraveled: 0.04,
  stepDistanceRemaining: 150,
  maneuverInstruction: 'Turn right onto Market Street',
  maneuverType: 'turn',
  maneuverModifier: 'right',
  secondaryInstruction: '',
  subInstruction: '',
  lanes: [
    { indications: ['left'], valid: false, activeDirection: '' },
    {
      indications: ['straight', 'right'],
      valid: true,
      activeDirection: 'right',
    },
  ],
  legIndex: 0,
  stepIndex: 1,
};

function emit<T>(emitter: jest.Mock, event: T) {
  act(() => (emitter.mock.calls[0]![0] as (event: T) => void)(event));
}

function text(renderer: ReactTestRenderer, testID: string) {
  const node = renderer.root.find(
    (element) =>
      element.props.testID === testID && typeof element.type === 'string'
  );
  return [node.props.children].flat().join('');
}

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

describe('RNNavigationView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('starts guidance along its route and stops it when unmounted', async () => {
    const renderer = await render(<RNNavigationView route={route} simulate />);
    expect(bindings.startActiveGuidance).toHaveBeenCalledWith(route, true);
    expect(renderer.root.findByType('MapView' as never).props.mapViewImpl).toBe(
      'rnmbxnav'
    );

    await act(async () => renderer.unmount());
    expect(native.stopNavigation).toHaveBeenCalled();
  });

  it('renders the banner, lanes, speed limit and road name from events', async () => {
    const renderer = await render(<RNNavigationView route={route} />);
    emit(native.onRouteProgress, progress);
    emit(native.onLocationChange, {
      latitude: 0,
      longitude: 0,
      speed: 10,
      course: 90,
      roadName: 'Market Street',
      speedLimit: { speed: 25, unit: 'mph', sign: 'mutcd' },
    });

    expect(text(renderer, 'rn-navigation-instruction')).toBe(
      'Turn right onto Market Street'
    );
    expect(text(renderer, 'rn-navigation-glyph')).toBe('→');
    expect(
      renderer.root
        .findByProps({ testID: 'rn-navigation-lanes' })
        .findAllByType('Text' as never)
        .map((lane) => lane.props.children)
    ).toEqual(['←', '→']);
    expect(
      renderer.root.findByProps({ testID: 'rn-navigation-speed-limit' }).props
        .accessibilityLabel
    ).toBe('Speed limit 25 mph');
    expect(text(renderer, 'rn-navigation-road-name')).toBe('Market Street');
  });

  it('switches the camera and mutes voice from its buttons', async () => {
    const renderer = await render(<RNNavigationView route={route} />);
    emit(native.onRouteProgress, progress);
    expect(native.setVoiceMuted).toHaveBeenLastCalledWith(false);

    await act(async () =>
      renderer.root
        .findByProps({ testID: 'rn-navigation-mute' })
        .props.onPress()
    );
    expect(native.setVoiceMuted).toHaveBeenLastCalledWith(true);

    renderer.root
      .findByProps({ testID: 'rn-navigation-camera' })
      .props.onPress();
    expect(native.setCameraState).toHaveBeenCalledWith('overview');
    emit(native.onCameraStateChange, { state: 'idle' });
    renderer.root
      .findByProps({ testID: 'rn-navigation-camera' })
      .props.onPress();
    expect(native.setCameraState).toHaveBeenLastCalledWith('following');
  });

  it('reports arrival and ends the trip', async () => {
    const onArrive = jest.fn();
    const onCancel = jest.fn();
    const renderer = await render(
      <RNNavigationView route={route} onArrive={onArrive} onCancel={onCancel} />
    );
    emit(native.onRouteProgress, progress);
    emit(native.onArrive, { waypointIndex: 1, isFinalDestination: true });
    expect(onArrive).toHaveBeenCalledWith({
      waypointIndex: 1,
      isFinalDestination: true,
    });
    expect(text(renderer, 'rn-navigation-arrived')).toBe('You have arrived');

    await act(async () =>
      renderer.root.findByProps({ testID: 'rn-navigation-end' }).props.onPress()
    );
    expect(native.stopNavigation).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalled();
    expect(
      renderer.root.findAllByProps({ testID: 'rn-navigation-banner' })
    ).toHaveLength(0);
  });

  it('reports a failed start through onError', async () => {
    bindings.startActiveGuidance.mockReturnValueOnce(
      Promise.reject(
        Object.assign(new Error('No location permission'), {
          code: 'start_failed',
        })
      )
    );
    const onError = jest.fn();
    await render(<RNNavigationView route={route} onError={onError} />);
    expect(onError).toHaveBeenCalledWith({
      code: 'start_failed',
      message: 'No location permission',
    });
  });
});
