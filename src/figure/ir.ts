// The Figure IR: what a projected scene is, before it is any particular file format.
//
// One projector, three serialisers. The IR carries ANALYTIC primitives — an arc stays an
// arc, a circle stays a circle — because a polyline approximation is the difference
// between a 12 KB figure and a 4 MB one, and between a figure that survives a journal's
// typesetting and one that does not.
//
// There is no bitmap in this module or anywhere downstream of it. `figure/` imports no
// canvas and no rasteriser, which is what makes "a screenshot cannot be exported as
// vector" a property of the import graph rather than a promise. test/import-graph.test.ts
// asserts it.

export interface Style {
  readonly stroke?: string
  readonly fill?: string
  /** Line width in POINTS at final size, not pixels. */
  readonly weight?: number
  readonly dash?: readonly number[]
  readonly opacity?: number
  readonly arrowHead?: boolean
}

export type Pt = readonly [number, number]

export type Prim =
  | { readonly kind: 'line'; readonly a: Pt; readonly b: Pt; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'polyline'; readonly pts: readonly Pt[]; readonly closed: boolean; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'circle'; readonly c: Pt; readonly r: number; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'ellipse'; readonly c: Pt; readonly rx: number; readonly ry: number; readonly rot: number; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'arc'; readonly c: Pt; readonly r: number; readonly a0: number; readonly a1: number; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'cubic'; readonly pts: readonly Pt[]; readonly style: Style; readonly depth: number; readonly id: string }
  | { readonly kind: 'label'; readonly at: Pt; readonly latex: string; readonly anchorX: number; readonly anchorY: number; readonly fontSize: number; readonly style: Style; readonly depth: number; readonly id: string }

export interface Figure {
  /** Page box in points. */
  readonly width: number
  readonly height: number
  readonly prims: readonly Prim[]
  /** World units per point, for the scale bar and for reproducing the projection. */
  readonly scale: number
  readonly title: string
  /** Everything the exporter could not do exactly, said out loud. */
  readonly caveats: readonly string[]
}

/** The documented physics palette. Applied to quantity glyphs, never to chrome. */
export const PALETTE: Readonly<Record<string, string>> = Object.freeze({
  force: '#c0392b',
  velocity: '#1f4fd8',
  acceleration: '#1e8449',
  field: '#8e44ad',
  structure: '#2b2b28',
  body: '#5d6d7e',
  guide: '#9a9a93',
  ink: '#1b1b1a',
})

export const colorOf = (name: string | undefined): string =>
  (name && PALETTE[name]) ?? PALETTE.ink!

/** Painter's algorithm: far primitives first. Labels always last. */
export function depthSort(prims: readonly Prim[]): Prim[] {
  return [...prims].sort((a, b) => {
    const la = a.kind === 'label' ? 1 : 0
    const lb = b.kind === 'label' ? 1 : 0
    if (la !== lb) return la - lb
    if (a.depth !== b.depth) return b.depth - a.depth
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0    // stable, and deterministic
  })
}

export function bounds(prims: readonly Prim[]): { min: Pt; max: Pt } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  const see = (p: Pt): void => {
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1])
    x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1])
  }
  for (const p of prims) {
    switch (p.kind) {
      case 'line': see(p.a); see(p.b); break
      case 'polyline': case 'cubic': p.pts.forEach(see); break
      case 'circle': see([p.c[0] - p.r, p.c[1] - p.r]); see([p.c[0] + p.r, p.c[1] + p.r]); break
      case 'ellipse': see([p.c[0] - p.rx, p.c[1] - p.ry]); see([p.c[0] + p.rx, p.c[1] + p.ry]); break
      case 'arc': see([p.c[0] - p.r, p.c[1] - p.r]); see([p.c[0] + p.r, p.c[1] + p.r]); break
      case 'label': see(p.at); break
    }
  }
  if (!Number.isFinite(x0)) return { min: [0, 0], max: [1, 1] }
  return { min: [x0, y0], max: [x1, y1] }
}
