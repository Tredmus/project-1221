import { describe, expect, it } from 'vitest';
import { gameDate } from './calendar';

describe('gameDate', () => {
  it('mirrors the real date 800 years back', () => {
    expect(gameDate(new Date('2026-10-01T12:00:00Z'))).toEqual({ year: 1226, month: 10, day: 1 });
    expect(gameDate(new Date('2027-01-01T00:00:00Z'))).toEqual({ year: 1227, month: 1, day: 1 });
  });

  it('keeps leap days', () => {
    expect(gameDate(new Date('2028-02-29T08:00:00Z'))).toEqual({ year: 1228, month: 2, day: 29 });
  });
});
