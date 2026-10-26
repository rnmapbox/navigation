import {
  CircleLayer,
  ShapeSource,
  SymbolLayer,
  type CircleLayerStyle,
  type SymbolLayerStyle,
} from '@rnmapbox/maps';
import { CarMap } from '@rnmapbox/navigation';
import type { FeatureCollection } from 'geojson';

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

const CIRCLE_STYLE: CircleLayerStyle = {
  circleRadius: 8,
  circleColor: '#7c3aed',
  circleStrokeWidth: 3,
  circleStrokeColor: '#ffffff',
};

const NAVIGATING_CIRCLE_STYLE: CircleLayerStyle = {
  ...CIRCLE_STYLE,
  circleRadius: 12,
  circleColor: '#f97316',
};

const LABEL_STYLE: SymbolLayerStyle = {
  textField: ['get', 'name'],
  textSize: 14,
  textOffset: [0, 1.4],
  textHaloColor: '#ffffff',
  textHaloWidth: 1.5,
};

/** Rendered once at the app root; shows on the car screen only. */
export default function CarMapLayers() {
  return (
    <CarMap>
      {({ activity }) => (
        <ShapeSource id="car-pois" shape={POIS}>
          <CircleLayer
            id="car-pois-circle"
            style={
              activity === 'navigating' ? NAVIGATING_CIRCLE_STYLE : CIRCLE_STYLE
            }
          />
          <SymbolLayer id="car-pois-label" style={LABEL_STYLE} />
        </ShapeSource>
      )}
    </CarMap>
  );
}
