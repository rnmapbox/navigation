import * as ReactNative from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { RNNavigationView } from '../RNNavigationView';
import type { Route } from '../Route';
import NativeNavigation, {
  type RouteProgressEvent,
} from '../specs/NativeRNMBXNavigationModule';

jest.mock('@rnmapbox/maps', () => ({
  MapView: 'MapView',
  StyleImport: 'StyleImport',
}));

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
      getDefaultDistanceUnit: jest.fn(() => 'metric'),
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
  maneuverComponents: [
    { type: 'text', text: 'Turn right onto Market Street', imageUrl: '' },
  ],
  maneuverType: 'turn',
  maneuverModifier: 'right',
  secondaryInstruction: '',
  secondaryComponents: [],
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

function host(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.find(
    (element) =>
      element.props.testID === testID && typeof element.type === 'string'
  );
}

function text(renderer: ReactTestRenderer, testID: string) {
  return [host(renderer, testID).props.children].flat().join('');
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

  it('draws road shields and exit numbers', async () => {
    const renderer = await render(<RNNavigationView route={route} />);
    emit(native.onRouteProgress, {
      ...progress,
      maneuverInstruction: 'Exit 4B',
      maneuverComponents: [
        { type: 'exit', text: 'Exit', imageUrl: '' },
        { type: 'exit-number', text: '4B', imageUrl: '' },
      ],
      secondaryInstruction: 'I 80 East / Oakland',
      secondaryComponents: [
        {
          type: 'icon',
          text: 'I 80',
          imageUrl: 'https://api.mapbox.com/public/shields/v4.1/US/i-80@3x.png',
        },
        { type: 'text', text: 'East', imageUrl: '' },
        { type: 'delimiter', text: '/', imageUrl: '' },
        { type: 'text', text: 'Oakland', imageUrl: '' },
      ],
    });

    expect(
      renderer.root
        .findByProps({ testID: 'rn-navigation-exit' })
        .findByType('Text' as never).props.children
    ).toEqual(['4B', ' ', '↗']);
    expect(
      host(renderer, 'rn-navigation-instruction').props.accessibilityLabel
    ).toBe('Exit 4B');
    expect(host(renderer, 'rn-navigation-shield').props.source).toEqual({
      uri: 'https://api.mapbox.com/public/shields/v4.1/US/i-80@3x.png',
    });
  });

  it('formats distances in the given unit and requests voice in it', async () => {
    bindings.requestRoutes.mockReturnValueOnce(new Promise(() => {}));
    const renderer = await render(
      <RNNavigationView
        route={route}
        waypoints={[
          [0, 0],
          [1, 1],
        ]}
        distanceUnit="imperial"
      />
    );
    emit(native.onRouteProgress, progress);
    expect(
      renderer.root
        .findByProps({ testID: 'rn-navigation-trip' })
        .findAllByType('Text' as never)[1]!
        .props.children.join('')
    ).toBe('5 min · 1.5 mi');
    expect(bindings.requestRoutes).not.toHaveBeenCalled();

    await act(async () =>
      renderer.update(
        <RNNavigationView
          waypoints={[
            [0, 0],
            [1, 1],
          ]}
          distanceUnit="imperial"
        />
      )
    );
    expect(bindings.requestRoutes).toHaveBeenCalledWith({
      waypoints: [
        { longitude: 0, latitude: 0 },
        { longitude: 1, latitude: 1 },
      ],
      alternatives: true,
      units: 'imperial',
    });
  });

  it('switches the map and its UI to night in dark mode', async () => {
    const lightPreset = (renderer: ReactTestRenderer) =>
      renderer.root.findByType('StyleImport' as never).props.config.lightPreset;
    const renderer = await render(<RNNavigationView route={route} />);
    expect(lightPreset(renderer)).toBe('day');

    jest.spyOn(ReactNative, 'useColorScheme').mockReturnValue('dark');
    await act(async () => renderer.update(<RNNavigationView route={route} />));
    expect(lightPreset(renderer)).toBe('night');

    await act(async () =>
      renderer.update(<RNNavigationView route={route} appearance="day" />)
    );
    expect(lightPreset(renderer)).toBe('day');

    await act(async () =>
      renderer.update(
        <RNNavigationView route={route} styleURL="mapbox://styles/me/custom" />
      )
    );
    expect(renderer.root.findAllByType('StyleImport' as never)).toHaveLength(0);
    jest.restoreAllMocks();
  });

  it('uses nightStyleURL at night and passes routeLineStyle to its viewport', async () => {
    const mapStyleURL = (renderer: ReactTestRenderer) =>
      renderer.root.findByType('MapView' as never).props.styleURL;
    const routeLineStyle = { color: '#7c3aed' };
    const renderer = await render(
      <RNNavigationView
        route={route}
        appearance="day"
        styleURL="mapbox://styles/me/day"
        nightStyleURL="mapbox://styles/me/night"
        routeLineStyle={routeLineStyle}
      />
    );
    expect(mapStyleURL(renderer)).toBe('mapbox://styles/me/day');
    expect(
      renderer.root.findByType('RNMBXNavigationViewport' as never).props
        .routeLineColor
    ).toBe('#7c3aed');

    await act(async () =>
      renderer.update(
        <RNNavigationView
          route={route}
          appearance="night"
          styleURL="mapbox://styles/me/day"
          nightStyleURL="mapbox://styles/me/night"
        />
      )
    );
    expect(mapStyleURL(renderer)).toBe('mapbox://styles/me/night');
  });

  it('shows the arrival card and ends the trip from it', async () => {
    const onArrive = jest.fn();
    const onCancel = jest.fn();
    bindings.requestRoutes.mockResolvedValueOnce({
      main: route,
      alternatives: [],
    });
    const renderer = await render(
      <RNNavigationView
        waypoints={[[0, 0], { coordinate: [1, 1], name: 'Ferry Building' }]}
        onArrive={onArrive}
        onCancel={onCancel}
      />
    );
    emit(native.onRouteProgress, progress);
    emit(native.onArrive, { waypointIndex: 1, isFinalDestination: true });
    expect(onArrive).toHaveBeenCalledWith({
      waypointIndex: 1,
      isFinalDestination: true,
    });
    const card = renderer.root.findByProps({
      testID: 'rn-navigation-arrived',
    });
    expect(
      card.findAllByType('Text' as never).map((node) => node.props.children)
    ).toEqual(['You have arrived', 'Ferry Building', 'End navigation']);

    await act(async () =>
      renderer.root
        .findByProps({ testID: 'rn-navigation-done' })
        .props.onPress()
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
