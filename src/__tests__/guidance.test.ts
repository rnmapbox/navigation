import {
  directionGlyph,
  formatArrival,
  formatDistance,
  formatDuration,
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

  it('formats durations', () => {
    expect(formatDuration(20)).toBe('< 1 min');
    expect(formatDuration(310)).toBe('5 min');
    expect(formatDuration(3900)).toBe('1 h 5 min');
  });

  it('formats the arrival time', () => {
    expect(formatArrival(30 * 60, new Date(2026, 0, 1, 9, 45))).toBe('10:15');
  });
});
