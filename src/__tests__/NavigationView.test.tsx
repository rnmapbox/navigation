import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { NavigationView } from '../NavigationView';
import type { Route } from '../Route';

jest.mock('../specs/RNMBXNavigationViewNativeComponent', () => ({
  __esModule: true,
  default: 'RNMBXNavigationView',
}));

jest.mock('../specs/NativeRNMBXNavigationModule', () => ({
  __esModule: true,
  default: {},
}));

function makeRoute(id: number) {
  return { id, isReleased: false, release: jest.fn() } as unknown as Route & {
    id: number;
    release: jest.Mock;
  };
}

const bindings = {
  requestRoutes: jest.fn(),
  startActiveGuidance: jest.fn(),
  previewRoute: jest.fn(),
  getRouteId: jest.fn((route: Route & { id: number }) => route.id),
  getRouteStats: jest.fn(),
};
globalThis.__RNMBXNavigationRoutes = bindings;

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function nativeProps(renderer: ReactTestRenderer) {
  return renderer.root.findByType('RNMBXNavigationView' as never).props;
}

describe('NavigationView', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes the id of a route prop to the native view', async () => {
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<NavigationView route={makeRoute(7)} simulate />);
    });
    expect(nativeProps(renderer)).toMatchObject({
      routeId: 7,
      simulate: true,
      mute: false,
    });
    expect(bindings.requestRoutes).not.toHaveBeenCalled();
  });

  it('requests a route through waypoints and releases it on unmount', async () => {
    const main = makeRoute(3);
    const alternative = makeRoute(4);
    bindings.requestRoutes.mockResolvedValueOnce({
      main,
      alternatives: [alternative],
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NavigationView
          waypoints={[
            [-122.39726, 37.79205],
            { coordinate: [-122.39351, 37.79554], name: 'Ferry Building' },
          ]}
        />
      );
    });
    expect(bindings.requestRoutes).toHaveBeenCalledWith({
      waypoints: [
        { longitude: -122.39726, latitude: 37.79205 },
        { longitude: -122.39351, latitude: 37.79554, name: 'Ferry Building' },
      ],
    });
    expect(alternative.release).toHaveBeenCalled();
    expect(nativeProps(renderer).routeId).toBe(3);

    await act(async () => renderer.unmount());
    expect(main.release).toHaveBeenCalled();
  });

  it('reports a failed route request through onError', async () => {
    bindings.requestRoutes.mockRejectedValueOnce(
      Object.assign(new Error('No route found'), { code: 'no_route' })
    );
    const onError = jest.fn();
    await act(async () => {
      create(
        <NavigationView
          waypoints={[
            [0, 0],
            [1, 1],
          ]}
          onError={onError}
        />
      );
    });
    expect(onError).toHaveBeenCalledWith({
      code: 'no_route',
      message: 'No route found',
    });
  });

  it('unwraps native events', async () => {
    const onArrive = jest.fn();
    const onCancel = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NavigationView
          route={makeRoute(1)}
          onArrive={onArrive}
          onCancel={onCancel}
        />
      );
    });
    const props = nativeProps(renderer);
    props.onArrive({
      nativeEvent: { waypointIndex: 1, isFinalDestination: true },
    });
    props.onCancel({ nativeEvent: {} });
    expect(onArrive).toHaveBeenCalledWith({
      waypointIndex: 1,
      isFinalDestination: true,
    });
    expect(onCancel).toHaveBeenCalledWith();
  });
});
