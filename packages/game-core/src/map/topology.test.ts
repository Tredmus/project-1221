import { describe, expect, it } from 'vitest';
import { borderLeveler, buildCountyPolygons, findCounty, signedArea } from './topology';
import type { BorderEdge, BorderPoint } from './types';

/** Points on a grid: id = x * 10 + y, at lon x, lat y. */
const grid = (x: number, y: number): BorderPoint => ({ id: x * 10 + y, lon: x, lat: y });
const point = (id: number) => grid(Math.floor(id / 10), id % 10);

let nextId = 1;
/** An edge from a to b with the given counties on its left and right. */
const edge = (a: number, b: number, left: number | null, right: number | null): BorderEdge => ({
  id: nextId++,
  point_a: a,
  point_b: b,
  left_county_id: left,
  right_county_id: right,
});

describe('buildCountyPolygons', () => {
  // Two unit squares side by side: county 1 at x 0..1, county 2 at x 1..2, sharing x = 1.
  const twoSquares = [
    edge(0, 10, 1, null), // bottom of 1, walking east
    edge(10, 11, 1, 2), // shared, walking north: 1 on the left, 2 on the right
    edge(11, 1, 1, null),
    edge(1, 0, 1, null),
    edge(10, 20, 2, null),
    edge(20, 21, 2, null),
    edge(21, 11, 2, null),
  ];

  it('walks each county counter-clockwise from shared edges', () => {
    const polygons = buildCountyPolygons(twoSquares, point);
    const one = polygons.get(1)!;
    const two = polygons.get(2)!;
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(new Set(one[0]!.outer)).toEqual(new Set([0, 10, 11, 1]));
    expect(new Set(two[0]!.outer)).toEqual(new Set([10, 20, 21, 11]));
    expect(signedArea(two[0]!.outer.map(point))).toBeGreaterThan(0);
  });

  it('finds the county a point lies in', () => {
    const polygons = buildCountyPolygons(twoSquares, point);
    expect(findCounty(0.5, 0.5, polygons, point)).toBe(1);
    expect(findCounty(1.5, 0.5, polygons, point)).toBe(2);
    expect(findCounty(3, 3, polygons, point)).toBeNull();
  });

  it('keeps two pieces that touch at one point apart', () => {
    // County 1: squares 0..1 and 1..2 (diagonal), touching at (1, 1).
    const edges = [
      edge(0, 10, 1, null),
      edge(10, 11, 1, null),
      edge(11, 1, 1, null),
      edge(1, 0, 1, null),
      edge(11, 21, 1, null),
      edge(21, 22, 1, null),
      edge(22, 12, 1, null),
      edge(12, 11, 1, null),
    ];
    const pieces = buildCountyPolygons(edges, point).get(1)!;
    expect(pieces).toHaveLength(2);
    expect(pieces.map((p) => p.outer.length)).toEqual([4, 4]);
  });

  it('turns an enclave into a hole of the county around it', () => {
    // County 1: the square 0..3; county 2: the square 1..2 inside it.
    const edges = [
      edge(0, 30, 1, null),
      edge(30, 33, 1, null),
      edge(33, 3, 1, null),
      edge(3, 0, 1, null),
      edge(11, 21, 2, 1),
      edge(21, 22, 2, 1),
      edge(22, 12, 2, 1),
      edge(12, 11, 2, 1),
    ];
    const polygons = buildCountyPolygons(edges, point);
    const outer = polygons.get(1)!;
    expect(outer).toHaveLength(1);
    expect(outer[0]!.holes).toHaveLength(1);
    expect(findCounty(1.5, 1.5, polygons, point)).toBe(2);
    expect(findCounty(0.5, 0.5, polygons, point)).toBe(1);
  });

  it('drops open chains instead of drawing garbage', () => {
    expect(buildCountyPolygons([edge(0, 10, 5, null), edge(10, 11, 5, null)], point).get(5)).toEqual([]);
  });
});

describe('borderLeveler', () => {
  const links = {
    counties: [
      { id: 1, duchy_id: 10 },
      { id: 2, duchy_id: 10 },
      { id: 3, duchy_id: 11 },
      { id: 4, duchy_id: 12 },
      { id: 5, duchy_id: 13 },
      { id: 6, duchy_id: null },
      { id: 7, duchy_id: null },
    ],
    duchies: [
      { id: 10, kingdom_id: 100 },
      { id: 11, kingdom_id: 100 },
      { id: 12, kingdom_id: 101 },
      { id: 13, kingdom_id: 102 },
    ],
    kingdoms: [
      { id: 100, empire_id: 1000 },
      { id: 101, empire_id: 1000 },
      { id: 102, empire_id: null },
    ],
  };
  const level = borderLeveler(links);
  const between = (a: number | null, b: number | null) => level(edge(0, 1, a, b));

  it('picks the highest tier that differs', () => {
    expect(between(1, 2)).toBe('county');
    expect(between(1, 3)).toBe('duchy');
    expect(between(1, 4)).toBe('kingdom');
    expect(between(1, 5)).toBe('empire');
    expect(between(1, null)).toBe('outer');
  });

  it('never merges unassigned counties, but draws them as county lines', () => {
    expect(between(6, 7)).toBe('county');
    expect(between(1, 6)).toBe('empire');
  });
});
