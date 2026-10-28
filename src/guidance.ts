const DIRECTION_GLYPHS: Record<string, string> = {
  'uturn': '↶',
  'sharp right': '↘',
  'right': '→',
  'slight right': '↗',
  'straight': '↑',
  'slight left': '↖',
  'left': '←',
  'sharp left': '↙',
};

/** Arrow for a Mapbox Directions direction, e.g. "slight left" or a lane indication. */
export function directionGlyph(direction: string): string {
  return DIRECTION_GLYPHS[direction] ?? '↑';
}

export function maneuverGlyph(type: string, modifier: string): string {
  switch (type) {
    case 'arrive':
      return '⚑';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return '↻';
    default:
      return directionGlyph(modifier);
  }
}

/**
 * Unit of the distances navigation UIs show and voice instructions use.
 *
 * @group Core
 */
export type DistanceUnit = 'metric' | 'imperial';

export function formatDistance(
  meters: number,
  unit: DistanceUnit = 'metric'
): string {
  if (unit === 'imperial') {
    const miles = meters / 1609.344;
    if (miles >= 0.1) {
      return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
    }
    return `${Math.max(0, Math.round((meters * 3.28084) / 50) * 50)} ft`;
  }
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`;
  }
  return `${Math.max(0, Math.round(meters / 10) * 10)} m`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) {
    return '< 1 min';
  }
  if (minutes < 60) {
    return `${minutes} min`;
  }
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/** Local arrival time as HH:MM. */
export function formatArrival(
  secondsFromNow: number,
  now = new Date()
): string {
  const arrival = new Date(now.getTime() + secondsFromNow * 1000);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(arrival.getHours())}:${pad(arrival.getMinutes())}`;
}
