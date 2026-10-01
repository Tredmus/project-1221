/**
 * The game calendar mirrors the real one minus 800 years (GDD 2): 1 Oct 2026 is 1 Oct 1226.
 * 800 is a multiple of 400, so leap years line up exactly and every real day has a twin.
 */
export const YEARS_BEHIND = 800;

export interface GameDate {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
}

/** The in-game date for a real moment, in UTC. */
export function gameDate(at: Date = new Date()): GameDate {
  return { year: at.getUTCFullYear() - YEARS_BEHIND, month: at.getUTCMonth() + 1, day: at.getUTCDate() };
}
