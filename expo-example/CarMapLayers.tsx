import { useEffect, useState } from 'react';
import {
  CircleLayer,
  ShapeSource,
  SymbolLayer,
  type CircleLayerStyle,
  type SymbolLayerStyle,
} from '@rnmapbox/maps';
import Navigation, { CarMap, type Position } from '@rnmapbox/navigation';
import type { FeatureCollection, Point } from 'geojson';

// Along the CarPlay screen's demo trip, Mapbox HQ to Union Square.
const POIS: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { name: 'Coffee', coordinates: [-122.40018, 37.79024] },
    { name: 'Charging', coordinates: [-122.40371, 37.78859] },
    { name: 'Parking', coordinates: [-122.40695, 37.78755] },
  ].map(({ name, coordinates }) => ({
    type: 'Feature',
    properties: { name },
    geometry: { type: 'Point', coordinates },
  })),
};

// The navigation styles light the map at night; emissive layers keep their colors.
const CIRCLE_STYLE: CircleLayerStyle = {
  circleRadius: 14,
  circleColor: '#d946ef',
  circleStrokeWidth: 3,
  circleStrokeColor: '#ffffff',
  circleEmissiveStrength: 1,
};

const NAVIGATING_CIRCLE_STYLE: CircleLayerStyle = {
  ...CIRCLE_STYLE,
  circleColor: '#f97316',
};

const CAR_RING_STYLE: CircleLayerStyle = {
  circleRadius: 60,
  circleColor: '#d946ef',
  circleOpacity: 0.25,
  circleStrokeWidth: 4,
  circleStrokeColor: '#d946ef',
  circlePitchAlignment: 'map',
  circleEmissiveStrength: 1,
};

const LABEL_STYLE: SymbolLayerStyle = {
  textField: ['get', 'name'],
  textSize: 14,
  textOffset: [0, 1.4],
  textHaloColor: '#ffffff',
  textHaloWidth: 1.5,
  textEmissiveStrength: 1,
};

/** Rendered in the app and as the CarPlay root (see index.ts); shows on the car screen only. */
export default function CarMapLayers() {
  const [carPosition, setCarPosition] = useState<Position>();

  useEffect(() => {
    const subscription = Navigation.addLocationListener((event) =>
      setCarPosition([event.longitude, event.latitude])
    );
    return () => subscription.remove();
  }, []);

  const carPoint: Point | undefined = carPosition && {
    type: 'Point',
    coordinates: carPosition,
  };

  return (
    <CarMap>
      {({ activity }) => (
        <>
          {carPoint && (
            <ShapeSource id="car-position" shape={carPoint}>
              <CircleLayer id="car-position-ring" style={CAR_RING_STYLE} />
            </ShapeSource>
          )}
          <ShapeSource id="car-pois" shape={POIS}>
            <CircleLayer
              id="car-pois-circle"
              style={
                activity === 'navigating'
                  ? NAVIGATING_CIRCLE_STYLE
                  : CIRCLE_STYLE
              }
            />
            <SymbolLayer id="car-pois-label" style={LABEL_STYLE} />
          </ShapeSource>
        </>
      )}
    </CarMap>
  );
}
