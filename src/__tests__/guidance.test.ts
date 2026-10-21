import {
  directionGlyph,
  formatArrival,
  formatDistance,
  formatDuration,
  isNight,
  maneuverGlyph,
} from '../guidance';

describe('guidance', () => {
  it('picks an arrow per maneuver', () => {
    expect(maneuverGlyph('turn', 'right')).toBe('→');
    expect(maneuverGlyph('turn', 'slight left')).toBe('↖');
    expect(maneuverGlyph('continue', 'uturn')).toBe('↶');
    expect(maneuverGlyph('roundabout', 'right')).toBe('↻');
    expect(maneuverGlyph('arrive', '')).toBe('⚑');
    expect(maneuverGlyph('depart', '')).toBe('↑');
  });

  it('falls back to straight for unknown directions', () => {
    expect(directionGlyph('none')).toBe('↑');
  });

  it('formats distances', () => {
    expect(formatDistance(-3)).toBe('0 m');
    expect(formatDistance(144)).toBe('140 m');
    expect(formatDistance(1260)).toBe('1.3 km');
    expect(formatDistance(23400)).toBe('23 km');
  });

  it('formats imperial distances', () => {
    expect(formatDistance(30, 'imperial')).toBe('100 ft');
    expect(formatDistance(150, 'imperial')).toBe('500 ft');
    expect(formatDistance(1609, 'imperial')).toBe('1.0 mi');
    expect(formatDistance(40000, 'imperial')).toBe('25 mi');
  });

  it('tells night from day by the sun', () => {
    // San Francisco on 2026-06-21: sunrise 05:48, sunset 20:35 PDT.
    const sf = [37.79, -122.39] as const;
    expect(isNight(...sf, new Date('2026-06-21T20:00:00Z'))).toBe(false);
    expect(isNight(...sf, new Date('2026-06-21T12:40:00Z'))).toBe(true);
    expect(isNight(...sf, new Date('2026-06-21T12:55:00Z'))).toBe(false);
    expect(isNight(...sf, new Date('2026-06-22T03:30:00Z'))).toBe(false);
    expect(isNight(...sf, new Date('2026-06-22T03:45:00Z'))).toBe(true);
    // Polar night and midnight sun in Tromsø.
    expect(isNight(69.65, 18.96, new Date('2026-12-21T11:00:00Z'))).toBe(true);
    expect(isNight(69.65, 18.96, new Date('2026-06-21T23:00:00Z'))).toBe(false);
  });

  it('formats durations', () => {
    expect(formatDuration(20)).toBe('< 1 min');
    expect(formatDuration(310)).toBe('5 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });

  it('formats the arrival time', () => {
    expect(formatArrival(30 * 60, new Date(2026, 0, 1, 9, 45))).toBe('10:15');
  });
});
