import { NavigationViewport } from '../NavigationViewport';

jest.mock('../specs/RNMBXNavigationViewportNativeComponent', () => ({
  __esModule: true,
  default: 'RNMBXNavigationViewport',
}));

describe('NavigationViewport', () => {
  it('fills in missing padding edges with 0', () => {
    const element = NavigationViewport({ padding: { top: 120, bottom: 80 } });
    expect(element.props.viewportPadding).toEqual({
      top: 120,
      right: 0,
      bottom: 80,
      left: 0,
    });
  });

  it('sends zero padding without a padding prop', () => {
    const element = NavigationViewport({});
    expect(element.props.viewportPadding).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('passes route line colors to the native view', () => {
    const element = NavigationViewport({
      routeLineStyle: { color: '#7c3aed', traveledColor: 'transparent' },
    });
    expect(element.props).toMatchObject({
      routeLineColor: '#7c3aed',
      routeLineCasingColor: undefined,
      routeLineAlternativeColor: undefined,
      routeLineTraveledColor: 'transparent',
    });
  });
});
