// src/lib/sacredGeometry.ts
// Pure geometry math for Alert Studio's shape elements + "geometry" background
// type (2026-08-30 follow-up) — direct request: "some objects etc that we
// could spin in the back, or trace in the back (like that weird issue we had
// in overlay studio making the trailing border that one timer)... think
// sacred geometry and other cool stuff we could programmatically generate."
//
// Everything here is generated math, not raster/SVG assets — plain .ts (no
// JSX), same convention hudTypes.ts already established for shape data that
// both a widget renderer and a settings-page static preview need to share.
// Every shape is drawn in a fixed 0-100 viewBox, centered at (50,50).

export type ShapeKind =
  | 'triangle' | 'square' | 'pentagon' | 'hexagon' | 'octagon'
  | 'star5' | 'hexagram' | 'ring'
  | 'vesica-piscis' | 'seed-of-life' | 'flower-of-life' | 'metatron-cube';

export type ShapeAnimMode = 'none' | 'spin' | 'spinReverse' | 'pulse' | 'chase' | 'rainbowChase';

// `traceable` — whether a "chase"/"rainbowChase" traveling comet makes sense
// at all. A comet needs ONE continuous path to travel along; the
// multi-circle sacred-geometry patterns (seed/flower/vesica/metatron) are
// many independent primitives with no single path to chase around, so those
// only ever offer spin/spinReverse/pulse in the UI — enforced both in the
// settings page's own dropdown (see AlertStudioSettings.tsx) and defensively
// in the renderer (falls back to 'spin' rather than rendering nothing).
export const SHAPE_KIND_OPTIONS: { value: ShapeKind; label: string; traceable: boolean }[] = [
  { value: 'triangle',       label: 'Triangle',                   traceable: true },
  { value: 'square',         label: 'Square',                     traceable: true },
  { value: 'pentagon',       label: 'Pentagon',                   traceable: true },
  { value: 'hexagon',        label: 'Hexagon',                    traceable: true },
  { value: 'octagon',        label: 'Octagon',                    traceable: true },
  { value: 'star5',          label: '5-Point Star',               traceable: true },
  { value: 'hexagram',       label: 'Hexagram (Star of David)',   traceable: true },
  { value: 'ring',           label: 'Ring',                       traceable: true },
  { value: 'vesica-piscis',  label: 'Vesica Piscis',               traceable: false },
  { value: 'seed-of-life',   label: 'Seed of Life',                traceable: false },
  { value: 'flower-of-life', label: 'Flower of Life',              traceable: false },
  { value: 'metatron-cube',  label: "Metatron's Cube",             traceable: false },
];

export function isTraceableShape(kind: ShapeKind): boolean {
  return SHAPE_KIND_OPTIONS.find(o => o.value === kind)?.traceable ?? false;
}

export interface ShapePrimitive {
  kind: 'polygon' | 'circle' | 'line';
  points?: string;
  cx?: number; cy?: number; r?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
}

const CX = 50, CY = 50, R = 42;

function regularPolygonPoints(sides: number, radius: number, rotationDeg = -90): string {
  const pts: string[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (rotationDeg + (360 / sides) * i) * (Math.PI / 180);
    pts.push(`${(CX + radius * Math.cos(a)).toFixed(2)},${(CY + radius * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

function starPoints(points: number, outerR: number, innerR: number, rotationDeg = -90): string {
  const pts: string[] = [];
  const step = 360 / (points * 2);
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? outerR : innerR;
    const a = (rotationDeg + step * i) * (Math.PI / 180);
    pts.push(`${(CX + radius * Math.cos(a)).toFixed(2)},${(CY + radius * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

// The defining geometric property of the Flower/Seed of Life: circle radius
// equals the spacing between centers, so every circle passes exactly
// through the centers of its 6 immediate neighbors. Centers sit on a
// triangular/hexagonal lattice built from two 60°-apart basis vectors —
// `rings=1` gives the classic 7-circle Seed of Life, `rings=2` the classic
// 19-circle Flower of Life.
function hexLatticePoints(rings: number, spacing: number): [number, number][] {
  const pts: [number, number][] = [];
  const v1: [number, number] = [spacing, 0];
  const v2: [number, number] = [spacing * Math.cos(Math.PI / 3), spacing * Math.sin(Math.PI / 3)];
  const range = rings + 1;
  const seen = new Set<string>();
  for (let a = -range; a <= range; a++) {
    for (let b = -range; b <= range; b++) {
      const x = a * v1[0] + b * v2[0];
      const y = a * v1[1] + b * v2[1];
      if (Math.hypot(x, y) <= rings * spacing + 0.01) {
        const key = `${x.toFixed(1)},${y.toFixed(1)}`;
        if (!seen.has(key)) { seen.add(key); pts.push([x, y]); }
      }
    }
  }
  return pts;
}

export function buildShapePrimitives(kind: ShapeKind): ShapePrimitive[] {
  switch (kind) {
    case 'triangle': return [{ kind: 'polygon', points: regularPolygonPoints(3, R) }];
    case 'square':   return [{ kind: 'polygon', points: regularPolygonPoints(4, R) }];
    case 'pentagon': return [{ kind: 'polygon', points: regularPolygonPoints(5, R) }];
    case 'hexagon':  return [{ kind: 'polygon', points: regularPolygonPoints(6, R) }];
    case 'octagon':  return [{ kind: 'polygon', points: regularPolygonPoints(8, R) }];
    case 'star5':    return [{ kind: 'polygon', points: starPoints(5, R, R * 0.42) }];
    // Two independent triangle paths, pointing opposite directions — the
    // classic hexagram construction. Both trace independently when chase is
    // active (two comets, one per triangle), which still reads as one
    // coherent effect rather than a bug.
    case 'hexagram': return [
      { kind: 'polygon', points: regularPolygonPoints(3, R, -90) },
      { kind: 'polygon', points: regularPolygonPoints(3, R, 90) },
    ];
    case 'ring': return [{ kind: 'circle', cx: CX, cy: CY, r: R }];
    case 'vesica-piscis': {
      const r = R * 0.62;
      return [
        { kind: 'circle', cx: CX - r / 2, cy: CY, r },
        { kind: 'circle', cx: CX + r / 2, cy: CY, r },
      ];
    }
    case 'seed-of-life': {
      const spacing = R * 0.44;
      return hexLatticePoints(1, spacing).map(([x, y]) => ({ kind: 'circle' as const, cx: CX + x, cy: CY + y, r: spacing }));
    }
    case 'flower-of-life': {
      const spacing = R * 0.28;
      return hexLatticePoints(2, spacing).map(([x, y]) => ({ kind: 'circle' as const, cx: CX + x, cy: CY + y, r: spacing }));
    }
    // 13 circle centers (1 center + inner hexagon at radius r + outer
    // hexagon at radius r√3, rotated 30° relative to the inner one — the
    // standard Metatron's Cube construction) with every one of the
    // C(13,2)=78 connecting lines drawn between them, plus a small circle
    // marker at each center. Dense but cheap — plain SVG <line> elements.
    case 'metatron-cube': {
      const spacing = R * 0.42;
      const pts: [number, number][] = [[0, 0]];
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        pts.push([spacing * Math.cos(a), spacing * Math.sin(a)]);
      }
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i + Math.PI / 6;
        pts.push([spacing * Math.sqrt(3) * Math.cos(a), spacing * Math.sqrt(3) * Math.sin(a)]);
      }
      const prims: ShapePrimitive[] = [];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          prims.push({ kind: 'line', x1: CX + pts[i][0], y1: CY + pts[i][1], x2: CX + pts[j][0], y2: CY + pts[j][1] });
        }
      }
      pts.forEach(([x, y]) => prims.push({ kind: 'circle', cx: CX + x, cy: CY + y, r: spacing * 0.16 }));
      return prims;
    }
  }
}
