// View state, as arithmetic rather than as three.js.
//
// The camera, the navigation cube and the active construction plane are three views of
// ONE fact: which axis you are looking down. Keeping that fact here, as plain numbers,
// means it can be tested without a GPU and that the cube cannot disagree with the plane
// indicator -- which is the class of bug that makes a viewport feel untrustworthy.
//
// The viewport camera is ORTHOGRAPHIC, always. The exporter is orthographic, so this is
// what makes the figure you export the figure you were looking at; a perspective viewport
// over an orthographic exporter is a promise the tool cannot keep.

export type Axis = '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
export type Plane = 'xy' | 'yz' | 'zx'
export type Vec = readonly [number, number, number]

export const AXES: readonly Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z']

/** Z is up. A physics diagram is drawn in the vertical plane, so -y is the default view. */
export const DEFAULT_AXIS: Axis = '-y'

export interface AxisView {
  /** Unit vector from the target towards the camera. */
  readonly eye: Vec
  readonly up: Vec
  /** The construction plane perpendicular to the view. */
  readonly plane: Plane
  /** What to call it in the status strip. */
  readonly label: string
}

const V: Record<Axis, Vec> = {
  '+x': [1, 0, 0], '-x': [-1, 0, 0],
  '+y': [0, 1, 0], '-y': [0, -1, 0],
  '+z': [0, 0, 1], '-z': [0, 0, -1],
}

export const axisVector = (a: Axis): Vec => V[a]

export function axisView(a: Axis): AxisView {
  const eye = V[a]
  // Up is +z unless we are looking along z, where it has to be something else.
  const up: Vec = a === '+z' || a === '-z' ? [0, 1, 0] : [0, 0, 1]
  const plane: Plane = a === '+x' || a === '-x' ? 'yz' : a === '+y' || a === '-y' ? 'zx' : 'xy'
  return { eye, up, plane, label: a.toUpperCase() }
}

/** The axis a free direction is closest to. Used when a drag ends near an axis. */
export function nearestAxis(dir: Vec): Axis {
  let best: Axis = DEFAULT_AXIS
  let bestDot = -Infinity
  for (const a of AXES) {
    const v = V[a]
    const d = dir[0] * v[0] + dir[1] * v[1] + dir[2] * v[2]
    if (d > bestDot) { bestDot = d; best = a }
  }
  return best
}

/** How far a direction is from the nearest axis, in radians. */
export function axisDeviation(dir: Vec): number {
  const a = axisVector(nearestAxis(dir))
  const d = dir[0] * a[0] + dir[1] * a[1] + dir[2] * a[2]
  const n = Math.hypot(dir[0], dir[1], dir[2]) || 1
  return Math.acos(Math.max(-1, Math.min(1, d / n)))
}

export const planeNormal = (p: Plane): Vec =>
  p === 'xy' ? [0, 0, 1] : p === 'zx' ? [0, 1, 0] : [1, 0, 0]

/**
 * Euler rotation that takes a three.js GridHelper (which lies in the XZ plane, normal +Y)
 * onto the given construction plane. The grid and the highlighted plane are built from
 * this one function so they cannot drift apart.
 */
export const gridRotation = (p: Plane): Vec =>
  p === 'zx' ? [0, 0, 0] : p === 'xy' ? [Math.PI / 2, 0, 0] : [0, 0, Math.PI / 2]

/** The same, for a PlaneGeometry, which lies in XY with normal +Z. */
export const planeRotation = (p: Plane): Vec =>
  p === 'xy' ? [0, 0, 0] : p === 'zx' ? [Math.PI / 2, 0, 0] : [0, Math.PI / 2, 0]

/** Which world axis the plane's two in-plane directions are, for the cursor readout. */
export const planeAxes = (p: Plane): readonly [string, string] =>
  p === 'xy' ? ['x', 'y'] : p === 'zx' ? ['x', 'z'] : ['y', 'z']

/** Round a world point to the grid, but only in the plane's own two directions. */
export function snapInPlane(p: Vec, plane: Plane, step: number): Vec {
  if (step <= 0) return p
  const n = planeNormal(plane)
  const r = (x: number): number => Math.round(x / step) * step
  return [
    n[0] ? p[0] : r(p[0]),
    n[1] ? p[1] : r(p[1]),
    n[2] ? p[2] : r(p[2]),
  ]
}

// ---------------------------------------------------------------------------
// The navigation cube

export interface CubeFace {
  readonly axis: Axis
  /** Face centre in cube-local coordinates, on the unit cube. */
  readonly centre: Vec
  readonly label: string
}

export const CUBE_FACES: readonly CubeFace[] = AXES.map((axis) => ({
  axis,
  centre: axisVector(axis),
  label: axis.toUpperCase().replace('+', ''),
}))

/** Face order for a three.js BoxGeometry: +x, -x, +y, -y, +z, -z. */
export const BOX_FACE_ORDER: readonly Axis[] = ['+x', '-x', '+y', '-y', '+z', '-z']

/**
 * A drag on the cube is an orbit. Screen dx, dy in pixels become yaw about world up and
 * pitch about the camera's right, in radians, at a fixed sensitivity.
 */
export const dragToOrbit = (dx: number, dy: number): { yaw: number; pitch: number } => ({
  yaw: -dx * 0.012,
  pitch: -dy * 0.012,
})

/** A drag shorter than this many pixels is a click, not an orbit. */
export const CLICK_SLOP = 4
