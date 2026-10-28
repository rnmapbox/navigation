import { Image } from 'react-native';

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

  it('passes the puck through, resolving a required model', () => {
    jest.spyOn(Image, 'resolveAssetSource').mockReturnValue({
      uri: 'http://localhost:8081/assets/car.glb?platform=ios&hash=1',
      width: 0,
      height: 0,
      scale: 1,
    });
    const element = NavigationViewport({
      puck: {
        bearingImage: 'arrow',
        scale: 1.5,
        model: { uri: 1, scale: [2, 2, 2] },
      },
    });
    expect(element.props.puck).toEqual({
      bearingImage: 'arrow',
      scale: 1.5,
      model: { uri: 'http://localhost:8081/assets/car.glb', scale: [2, 2, 2] },
    });
  });

  it('sends no puck without a puck prop', () => {
    expect(NavigationViewport({}).props.puck).toBeUndefined();
  });
});
