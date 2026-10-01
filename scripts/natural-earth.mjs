// npm run map:natural-earth — downloads Natural Earth 10m coastline, land, rivers and lakes
// (public domain, naturalearthdata.com), clips them to the game's area, lightly simplifies
// them and writes apps/admin/public/natural-earth/*.json for the map editor.
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Europe, Anatolia, the crusader states and the Ayyubids, with a margin.
const BBOX = { west: -30, south: 10, east: 65, north: 75 }
// About 100 m: invisible at tracing zoom, and it keeps the files small.
const TOLERANCE = 0.001
const DECIMALS = 4

const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'admin', 'public', 'natural-earth')

const LAYERS = {
  coastline: { sources: ['ne_10m_coastline'], kind: 'line', keep: [] },
  land: { sources: ['ne_10m_land'], kind: 'polygon', keep: [] },
  rivers: { sources: ['ne_10m_rivers_lake_centerlines', 'ne_10m_rivers_europe'], kind: 'line', keep: ['name', 'scalerank'] },
  lakes: { sources: ['ne_10m_lakes', 'ne_10m_lakes_europe'], kind: 'polygon', keep: ['name', 'scalerank'] },
}

const inside = ([x, y]) => x >= BBOX.west && x <= BBOX.east && y >= BBOX.south && y <= BBOX.north
const round = (v) => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS

// Liang–Barsky: the part of segment a-b inside the box, or null.
function clipSegment(a, b) {
  let t0 = 0
  let t1 = 1
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const checks = [
    [-dx, a[0] - BBOX.west],
    [dx, BBOX.east - a[0]],
    [-dy, a[1] - BBOX.south],
    [dy, BBOX.north - a[1]],
  ]
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null
    } else {
      const r = q / p
      if (p < 0) t0 = Math.max(t0, r)
      else t1 = Math.min(t1, r)
      if (t0 > t1) return null
    }
  }
  return [
    [a[0] + t0 * dx, a[1] + t0 * dy],
    [a[0] + t1 * dx, a[1] + t1 * dy],
  ]
}

// A line cut to the box: possibly several pieces.
function clipLine(coords) {
  const pieces = []
  let current = null
  for (let i = 0; i < coords.length - 1; i++) {
    const seg = clipSegment(coords[i], coords[i + 1])
    if (!seg) {
      if (current) pieces.push(current)
      current = null
      continue
    }
    if (!current) current = [seg[0]]
    current.push(seg[1])
    if (!inside(coords[i + 1])) {
      pieces.push(current)
      current = null
    }
  }
  if (current) pieces.push(current)
  return pieces.filter((p) => p.length >= 2)
}

// Sutherland–Hodgman against the four box edges.
function clipRing(ring) {
  const edges = [
    [(p) => p[0] >= BBOX.west, (a, b) => cross(a, b, 0, BBOX.west)],
    [(p) => p[0] <= BBOX.east, (a, b) => cross(a, b, 0, BBOX.east)],
    [(p) => p[1] >= BBOX.south, (a, b) => cross(a, b, 1, BBOX.south)],
    [(p) => p[1] <= BBOX.north, (a, b) => cross(a, b, 1, BBOX.north)],
  ]
  let out = ring.slice(0, -1)
  for (const [keep, at] of edges) {
    const input = out
    out = []
    for (let i = 0; i < input.length; i++) {
      const cur = input[i]
      const prev = input[(i + input.length - 1) % input.length]
      if (keep(cur)) {
        if (!keep(prev)) out.push(at(prev, cur))
        out.push(cur)
      } else if (keep(prev)) {
        out.push(at(prev, cur))
      }
    }
    if (!out.length) return null
  }
  return out.length >= 3 ? [...out, out[0]] : null
}

function cross(a, b, axis, value) {
  const t = (value - a[axis]) / (b[axis] - a[axis])
  return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]
}

// Douglas–Peucker, iterative.
function simplify(coords) {
  if (coords.length <= 2) return coords
  const keep = new Uint8Array(coords.length)
  keep[0] = keep[coords.length - 1] = 1
  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [first, last] = stack.pop()
    let max = 0
    let index = 0
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistance(coords[i], coords[first], coords[last])
      if (d > max) {
        max = d
        index = i
      }
    }
    if (max > TOLERANCE * TOLERANCE) {
      keep[index] = 1
      stack.push([first, index], [index, last])
    }
  }
  return coords.filter((_, i) => keep[i])
}

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const l2 = dx * dx + dy * dy
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
  const x = a[0] + t * dx - p[0]
  const y = a[1] + t * dy - p[1]
  return x * x + y * y
}

const finish = (coords) => {
  const out = []
  for (const [x, y] of simplify(coords)) {
    const p = [round(x), round(y)]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return out
}

function lines(geometry) {
  const all = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : []
  return all.flatMap(clipLine).map(finish).filter((l) => l.length >= 2)
}

function polygons(geometry) {
  const all = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  const out = []
  for (const rings of all) {
    const [outer, ...holes] = rings.map(clipRing)
    if (!outer) continue
    const shape = [finish(outer), ...holes.filter(Boolean).map(finish)].filter((r) => r.length >= 4)
    if (shape.length) out.push(shape)
  }
  return out
}

async function download(name) {
  const res = await fetch(`${BASE}${name}.geojson`)
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  return res.json()
}

mkdirSync(OUT, { recursive: true })
for (const [layer, { sources, kind, keep }] of Object.entries(LAYERS)) {
  const features = []
  for (const source of sources) {
    const data = await download(source)
    for (const f of data.features) {
      if (!f.geometry) continue
      const properties = Object.fromEntries(keep.filter((k) => f.properties?.[k] != null).map((k) => [k, f.properties[k]]))
      if (kind === 'line') {
        for (const coordinates of lines(f.geometry)) features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates } })
      } else {
        for (const coordinates of polygons(f.geometry)) features.push({ type: 'Feature', properties, geometry: { type: 'Polygon', coordinates } })
      }
    }
  }
  const file = join(OUT, `${layer}.json`)
  writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
  console.log(`${layer}: ${features.length} features, ${(statSync(file).size / 1024).toFixed(0)} KB`)
}
