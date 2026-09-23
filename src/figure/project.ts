// Scene -> Figure IR. An orthographic projection computed from the model, analytically.
//
// A circle projects to a circle when the view is along its axis and to an ellipse
// otherwise; an arc in a plane parallel to the image plane stays an arc. Only the helix
// is sampled, because a projected helix is not any conic and pretending otherwise would
// be a lie in the file. Every approximation the exporter makes is listed in
// `figure.caveats` and shown in the export dialog.

import { ADValue } from '../core/adexpr.js'
import { GeometryItem, Scene, numberOf, vectorOf } from '../core/scene.js'
import { Vec3, add, cross, dot, normalize, scale, sub, norm } from '../core/frame.js'
import { Figure, Prim, Pt, Style, bounds, colorOf, depthSort } from './ir.js'
import { ViewDecl } from '../core/dsl.js'
import { isDimless, dimEq, NAMED } from '../core/dimension.js'

export interface ProjectOptions {
  /** Page box in points. A4 landscape minus margins by default. */
  readonly width?: number
  readonly height?: number
  readonly margin?: number
  /** Metres of arrow per newton of force, and so on, per dimension name. */
  readonly glyphScale?: Readonly<Record<string, number>>
  readonly view?: string
  readonly showLabels?: boolean
}

interface Camera {
  readonly eye: Vec3       // view direction (from the scene towards the viewer is -eye)
  readonly u: Vec3         // image x
  readonly v: Vec3         // image y
}

const DEFAULT_GLYPH_SCALE: Record<string, number> = {
  force: 0.02,             // metres drawn per newton
  acceleration: 0.05,
  velocity: 0.1,
  efield: 1e-4,
}

export function projectScene(scene: Scene, opts: ProjectOptions = {}): Figure {
  const width = opts.width ?? 560
  const height = opts.height ?? 380
  const margin = opts.margin ?? 24
  const caveats: string[] = []

  const view = pickView(scene, opts.view)
  const cam = cameraFor(scene, view)
  const glyph = { ...DEFAULT_GLYPH_SCALE, ...(opts.glyphScale ?? {}) }

  const raw: Prim[] = []
  for (const g of scene.geometry) emit(scene, g, cam, glyph, raw, caveats)

  if (opts.showLabels !== false) emitLabels(scene, cam, glyph, raw)

  // Fit: one uniform scale, aspect preserved, so exported geometry is the model's.
  const b = bounds(raw)
  const spanX = Math.max(1e-9, b.max[0] - b.min[0])
  const spanY = Math.max(1e-9, b.max[1] - b.min[1])
  const s = Math.min((width - 2 * margin) / spanX, (height - 2 * margin) / spanY)
  const cx = (b.min[0] + b.max[0]) / 2
  const cy = (b.min[1] + b.max[1]) / 2
  const map = (p: Pt): Pt => [width / 2 + (p[0] - cx) * s, height / 2 - (p[1] - cy) * s]

  const prims = depthSort(raw.map((p) => remap(p, map, s)))

  return { width, height, prims, scale: 1 / s, title: view?.name ?? 'view', caveats }
}

function pickView(scene: Scene, name?: string): ViewDecl | undefined {
  if (name) return scene.views.find((v) => v.name === name)
  return scene.views[0]
}

function cameraFor(scene: Scene, view: ViewDecl | undefined): Camera {
  const dirOf = (src: string | undefined, fallback: Vec3): Vec3 => {
    if (!src) return fallback
    const v = scene.names.get(src)
    if (v) return normalize(vectorOf(scene, v))
    // A literal such as "vec(0, 1, 0)" written in the view block.
    const m = /vec\(\s*(-?[\d.]+)[^,]*,\s*(-?[\d.]+)[^,]*,\s*(-?[\d.]+)/.exec(src)
    if (m) return normalize([Number(m[1]), Number(m[2]), Number(m[3])])
    return fallback
  }
  const eye = dirOf(view?.along, [0, 1, 0])
  let up = dirOf(view?.up, [0, 0, 1])
  if (Math.abs(dot(eye, up)) > 1 - 1e-9) up = Math.abs(eye[2]!) < 0.9 ? [0, 0, 1] : [0, 1, 0]
  const u = normalize(cross(up, eye))
  const v = cross(eye, u)
  return { eye, u, v }
}

const px = (cam: Camera, p: Vec3): Pt => [dot(p, cam.u), dot(p, cam.v)]
const dep = (cam: Camera, p: Vec3): number => dot(p, cam.eye)

function styleOf(g: GeometryItem, extra: Partial<Style> = {}): Style {
  return {
    stroke: colorOf(g.style.stroke),
    ...(g.style.fill ? { fill: colorOf(g.style.fill) } : {}),
    weight: g.style.weight ? Number(g.style.weight) : 1,
    ...extra,
  }
}

function emit(
  scene: Scene, g: GeometryItem, cam: Camera,
  glyph: Record<string, number>, out: Prim[], caveats: string[],
): void {
  const vv = (key: string): Vec3 => {
    const a = g.props.get(key)
    if (!a) throw new Error(`${g.name}: missing \`${key}\``)
    return vectorOf(scene, a)
  }
  const nn = (key: string): number => {
    const a = g.props.get(key)
    if (!a) throw new Error(`${g.name}: missing \`${key}\``)
    return numberOf(scene, a)
  }
  const has = (key: string): boolean => g.props.has(key)

  switch (g.op) {
    case 'segment': {
      const a = vv('from'), b = vv('to')
      out.push({ kind: 'line', a: px(cam, a), b: px(cam, b), style: styleOf(g), depth: (dep(cam, a) + dep(cam, b)) / 2, id: g.name })
      break
    }
    case 'polygon': {
      const pts: Vec3[] = []
      for (let i = 0; has(`p${i}`); i++) pts.push(vv(`p${i}`))
      out.push({
        kind: 'polyline', pts: pts.map((p) => px(cam, p)), closed: true,
        style: styleOf(g, { fill: '#00000010' }),
        depth: pts.reduce((s, p) => s + dep(cam, p), 0) / Math.max(1, pts.length), id: g.name,
      })
      break
    }
    case 'sphere': {
      const c = vv('center'), r = nn('radius')
      out.push({ kind: 'circle', c: px(cam, c), r, style: styleOf(g), depth: dep(cam, c), id: g.name })
      break
    }
    case 'marker': case 'anchor': {
      const c = vv('at')
      const p = px(cam, c)
      const h = 0.04
      out.push({ kind: 'line', a: [p[0] - h, p[1] - h], b: [p[0] + h, p[1] + h], style: styleOf(g), depth: dep(cam, c), id: `${g.name}/1` })
      out.push({ kind: 'line', a: [p[0] - h, p[1] + h], b: [p[0] + h, p[1] - h], style: styleOf(g), depth: dep(cam, c), id: `${g.name}/2` })
      break
    }
    case 'arrow': {
      const at = vv('at')
      const q = g.props.get('vector')!
      const vec = vectorOf(scene, q)
      const k = glyphScaleFor(q, glyph)
      const tip = add(at, scale(vec, k))
      if (norm(sub(tip, at)) < 1e-12) break
      out.push({
        kind: 'line', a: px(cam, at), b: px(cam, tip),
        style: styleOf(g, { arrowHead: true, weight: 1.4 }),
        depth: (dep(cam, at) + dep(cam, tip)) / 2, id: g.name,
      })
      break
    }
    case 'arc': {
      const c = vv('center'), from = normalize(vv('from')), to = normalize(vv('to'))
      const r = nn('radius')
      const n = has('normal') ? normalize(vv('normal')) : normalize(cross(from, to))
      if (Math.abs(Math.abs(dot(n, cam.eye)) - 1) < 1e-6) {
        // The arc plane is parallel to the image plane: it stays a true arc.
        const a0 = Math.atan2(dot(from, cam.v), dot(from, cam.u))
        const a1 = Math.atan2(dot(to, cam.v), dot(to, cam.u))
        out.push({ kind: 'arc', c: px(cam, c), r, a0, a1, style: styleOf(g), depth: dep(cam, c), id: g.name })
      } else {
        const pts: Pt[] = []
        const total = Math.acos(Math.max(-1, Math.min(1, dot(from, to))))
        const steps = 48
        const axis = normalize(cross(from, to))
        for (let i = 0; i <= steps; i++) {
          const a = (total * i) / steps
          const d = rodrigues(from, axis, a)
          pts.push(px(cam, add(c, scale(d, r))))
        }
        out.push({ kind: 'polyline', pts, closed: false, style: styleOf(g), depth: dep(cam, c), id: g.name })
        pushOnce(caveats, 'An arc whose plane is not parallel to the image plane is exported as a 48-segment polyline.')
      }
      break
    }
    case 'helix': {
      const a = vv('from'), b = vv('to')
      const turns = Math.max(1, Math.round(nn('turns')))
      const r = nn('radius')
      const axis = sub(b, a)
      const len = norm(axis)
      if (len < 1e-12) break
      const e1 = normalize(axis)
      const e2 = normalize(cross(e1, Math.abs(e1[2]!) < 0.9 ? [0, 0, 1] : [1, 0, 0]))
      const e3 = cross(e1, e2)
      const steps = turns * 16
      const pts: Pt[] = []
      for (let i = 0; i <= steps; i++) {
        const t = i / steps
        const th = 2 * Math.PI * turns * t
        // Taper the coil to zero radius at both ends so it meets its anchors.
        const taper = Math.sin(Math.PI * Math.min(1, Math.max(0, (t - 0.1) / 0.8))) ** 0.25
        const rr = r * (t < 0.1 || t > 0.9 ? 0 : taper)
        const p = add(add(a, scale(e1, len * t)), add(scale(e2, rr * Math.cos(th)), scale(e3, rr * Math.sin(th))))
        pts.push(px(cam, p))
      }
      out.push({ kind: 'polyline', pts, closed: false, style: styleOf(g), depth: (dep(cam, a) + dep(cam, b)) / 2, id: g.name })
      pushOnce(caveats, 'A helix has no exact projected conic form and is exported as a sampled polyline.')
      break
    }
    default:
      pushOnce(caveats, `Geometry \`${g.op}\` has no vector form yet and was omitted.`)
  }
}

function glyphScaleFor(q: ADValue, glyph: Record<string, number>): number {
  for (const [name, k] of Object.entries(glyph)) {
    const d = NAMED[name]
    if (d && dimEq(q.dim, d)) return k
  }
  return isDimless(q.dim) ? 1 : 0.1
}

function rodrigues(v: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a)
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)))
}

const ANCHORS: Record<string, [number, number]> = {
  'above-right': [0.5, 1], 'above': [0, 1], 'below': [0, -1], 'left': [-1, 0],
  'right': [1, 0], 'tip': [0.6, 0.6], 'mid': [0.5, 0.5], 'arc-mid': [1, 0.4], 'auto': [0.5, 0.5],
}

function emitLabels(scene: Scene, cam: Camera, glyph: Record<string, number>, out: Prim[]): void {
  for (const l of scene.labels) {
    const anchor = ANCHORS[l.anchor] ?? ANCHORS.auto!
    const at = labelPoint(scene, l.target, cam, glyph) ?? geometryPoint(scene, l.target)
    if (!at) continue
    out.push({
      kind: 'label', at: px(cam, at), latex: l.latex,
      anchorX: anchor[0], anchorY: anchor[1], fontSize: 11,
      style: { stroke: colorOf('ink') }, depth: -Infinity, id: `label/${l.target}`,
    })
  }
}

/**
 * A label on a name with no position of its own hangs on the geometry of the same name:
 * `label "theta"` finds the ramp's `ramp.theta` arc. That is how an angle label lands on
 * its own arc without the author having to say where.
 */
function geometryPoint(scene: Scene, target: string): Vec3 | undefined {
  const g = scene.geometry.find((it) => it.name === target || it.name.endsWith(`.${target}`))
  if (!g) return undefined
  for (const key of ['center', 'at', 'from', 'p0']) {
    const v = g.props.get(key)
    if (v && v.t.length === 3) return vectorOf(scene, v)
  }
  return undefined
}

/** Where a label hangs: the tip of a vector glyph, or the position of a body. */
function labelPoint(scene: Scene, target: string, cam: Camera, glyph: Record<string, number>): Vec3 | undefined {
  const force = scene.names.get(`${target}.force`)
  const pos = scene.names.get(`${target}.position`)
  if (force && pos) {
    const v = vectorOf(scene, force)
    return add(vectorOf(scene, pos), scale(v, glyphScaleFor(force, glyph)))
  }
  if (pos) return vectorOf(scene, pos)
  const direct = scene.names.get(target)
  if (direct && direct.t.length === 3) return vectorOf(scene, direct)
  // A label on a scalar parameter (an angle, say) hangs at the owner's origin.
  const owner = target.split('.')[0]!
  const op = scene.names.get(`${owner}.position`)
  return op ? vectorOf(scene, op) : undefined
}

function pushOnce(list: string[], msg: string): void {
  if (!list.includes(msg)) list.push(msg)
}

function remap(p: Prim, map: (q: Pt) => Pt, s: number): Prim {
  switch (p.kind) {
    case 'line': return { ...p, a: map(p.a), b: map(p.b) }
    case 'polyline': case 'cubic': return { ...p, pts: p.pts.map(map) }
    case 'circle': return { ...p, c: map(p.c), r: p.r * s }
    case 'ellipse': return { ...p, c: map(p.c), rx: p.rx * s, ry: p.ry * s }
    case 'arc': return { ...p, c: map(p.c), r: p.r * s }
    case 'label': return { ...p, at: map(p.at) }
  }
}
