import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { AppRegistry } from 'react-native';

import { CarMap } from '../CarMap';
import { Navigation } from '../Navigation';
import NativeNavigation, {
  type CarMapEvent,
} from '../specs/NativeRNMBXNavigationModule';

jest.mock('@rnmapbox/maps', () => ({ MapView: 'MapView' }));

jest.mock('../specs/NativeRNMBXNavigationModule', () => ({
  __esModule: true,
  default: { getCarMap: jest.fn(), onCarMapChange: jest.fn() },
}));

const native = jest.mocked(NativeNavigation);

let emitCarMap: (event: CarMapEvent) => void;
const remove = jest.fn();

function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(element);
  });
  return renderer;
}

function carMapHosts(renderer: ReactTestRenderer) {
  return renderer.root.findAll((node) => node.type === ('MapView' as never));
}

beforeEach(() => {
  native.getCarMap.mockReturnValue({ id: 3, activity: 'browsing' });
  native.onCarMapChange.mockImplementation((listener) => {
    emitCarMap = listener;
    return { remove } as never;
  });
  remove.mockClear();
});

describe('CarMap', () => {
  it('renders nothing while no car screen shows a map', () => {
    native.getCarMap.mockReturnValue({ id: 0, activity: 'browsing' });
    expect(render(<CarMap />).toJSON()).toBeNull();
  });

  it('remounts on the next map and passes the activity to function children', () => {
    const children = jest.fn(() => null);
    const renderer = render(<CarMap>{children}</CarMap>);
    expect(carMapHosts(renderer)[0]?.props.mapViewImpl).toBe('rnmbxnavcar:3');
    expect(children).toHaveBeenLastCalledWith({ activity: 'browsing' });

    act(() => emitCarMap({ id: 4, activity: 'navigating' }));
    expect(carMapHosts(renderer)[0]?.props.mapViewImpl).toBe('rnmbxnavcar:4');
    expect(children).toHaveBeenLastCalledWith({ activity: 'navigating' });
  });

  it('unsubscribes on unmount', () => {
    const renderer = render(<CarMap />);
    act(() => renderer.unmount());
    expect(remove).toHaveBeenCalled();
  });

  it('leaves the car map to a mounted CarPlay root', () => {
    const register = jest.spyOn(AppRegistry, 'registerComponent');
    Navigation.registerCarPlayRoot(() => <CarMap />);
    const [appKey, provider] = register.mock.lastCall!;
    expect(appKey).toBe('RNMBXNavigationCarPlayRoot');
    const CarPlayRoot = provider();

    const app = render(<CarMap />);
    expect(carMapHosts(app)).toHaveLength(1);

    const root = render(<CarPlayRoot />);
    expect(carMapHosts(root)).toHaveLength(1);
    expect(carMapHosts(app)).toHaveLength(0);

    act(() => root.unmount());
    expect(carMapHosts(app)).toHaveLength(1);
  });
});
