// Frames. A tree rooted at `world`; each node carries a rigid transform relative to its
// parent as a unit quaternion plus a translation in metres.
//
// Quaternions rather than matrices because a drag composes thousands of small rotations
// and renormalising a quaternion is one sqrt, where re-orthonormalising a matrix is a
// Gram-Schmidt pass that is both slower and less accurate.
//
// The rule that matters: a vector's frame is part of its TYPE. Combining quantities in
// different frames is an error, not a conversion. `reexpress` produces a NEW value; it
// never mutates. Acceptance example E is the round-trip test for this file.

export type Vec3 = readonly [number, number, number]
export type Quat = readonly [number, number, number, number] // x, y, z, w
export type Mat3 = readonly number[] // row-major, length 9

export const v3 = (x: number, y: number, z: number): Vec3 => [x, y, z]
export const V0: Vec3 = [0, 0, 0]

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a))
export function normalize(a: Vec3): Vec3 {
  const n = norm(a)
  if (n === 0) throw new Error('cannot normalize a zero vector')
  return scale(a, 1 / n)
}

export const QID: Quat = [0, 0, 0, 1]

export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]]

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3])
  if (n === 0) throw new Error('cannot normalize a zero quaternion')
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n]
}

/** Rotation of `angle` radians about `axis` (need not be unit). */
export function qFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis)
  const h = angle / 2, s = Math.sin(h)
  return [a[0] * s, a[1] * s, a[2] * s, Math.cos(h)]
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  // v' = v + 2 * cross(q.xyz, cross(q.xyz, v) + q.w * v)   (no quaternion multiply)
  const u: Vec3 = [q[0], q[1], q[2]]
  const t = cross(u, add(cross(u, v), scale(v, q[3])))
  return add(v, scale(t, 2))
}

export function qToMat3(q: Quat): Mat3 {
  const [x, y, z, w] = q
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ]
}

/** A rigid transform: rotate then translate. Maps LOCAL coordinates to PARENT. */
export interface Rigid { readonly q: Quat; readonly t: Vec3 }

export const RIGID_ID: Rigid = { q: QID, t: V0 }

export const rigidApply = (r: Rigid, p: Vec3): Vec3 => add(qRotate(r.q, p), r.t)
export const rigidApplyDir = (r: Rigid, v: Vec3): Vec3 => qRotate(r.q, v)

export function rigidCompose(a: Rigid, b: Rigid): Rigid {
  // (a ∘ b)(p) = a(b(p))
  return { q: qNormalize(qMul(a.q, b.q)), t: add(qRotate(a.q, b.t), a.t) }
}

export function rigidInverse(r: Rigid): Rigid {
  const qi = qConj(r.q)
  return { q: qi, t: scale(qRotate(qi, r.t), -1) }
}

export const WORLD = 'world'

export interface FrameDef {
  readonly id: string
  readonly parent: string | null
  /** Transform from this frame's coordinates to the parent's. */
  readonly local: Rigid
}

export class FrameTree {
  private frames = new Map<string, FrameDef>()

  constructor() {
    this.frames.set(WORLD, { id: WORLD, parent: null, local: RIGID_ID })
  }

  has(id: string): boolean { return this.frames.has(id) }
  get(id: string): FrameDef {
    const f = this.frames.get(id)
    if (!f) throw new Error(`no such frame \`${id}\``)
    return f
  }
  ids(): string[] { return [...this.frames.keys()] }

  define(id: string, parent: string, local: Rigid): void {
    if (id === WORLD) throw new Error('cannot redefine the world frame')
    if (!this.frames.has(parent)) throw new Error(`no such parent frame \`${parent}\``)
    // Reject cycles before inserting: walk up from `parent` looking for `id`.
    for (let p: string | null = parent; p; p = this.frames.get(p)?.parent ?? null) {
      if (p === id) throw new Error(`frame \`${id}\` would be its own ancestor`)
    }
    this.frames.set(id, { id, parent, local })
  }

  /** Chain of ids from `id` up to the root, inclusive. */
  ancestry(id: string): string[] {
    const out: string[] = []
    for (let p: string | null = id; p; p = this.frames.get(p)?.parent ?? null) {
      if (!this.frames.has(p)) throw new Error(`no such frame \`${p}\``)
      out.push(p)
    }
    return out
  }

  /** Transform from `id` coordinates to world coordinates. */
  toWorld(id: string): Rigid {
    let r = RIGID_ID
    for (let p: string | null = id; p; p = this.frames.get(p)!.parent) {
      r = rigidCompose(this.frames.get(p)!.local, r)
    }
    return r
  }

  /**
   * Transform taking coordinates expressed in `from` to coordinates expressed in `to`.
   * Composed through the common ancestor, so sibling frames do not detour via world
   * when they share a closer parent.
   */
  between(from: string, to: string): Rigid {
    if (from === to) return RIGID_ID
    const upFrom = this.ancestry(from)
    const upTo = new Set(this.ancestry(to))
    const common = upFrom.find((id) => upTo.has(id))
    if (!common) throw new Error(`frames \`${from}\` and \`${to}\` are in different trees`)
    let a = RIGID_ID // from -> common
    for (let p: string | null = from; p && p !== common; p = this.frames.get(p)!.parent) {
      a = rigidCompose(this.frames.get(p)!.local, a)
    }
    let b = RIGID_ID // to -> common
    for (let p: string | null = to; p && p !== common; p = this.frames.get(p)!.parent) {
      b = rigidCompose(this.frames.get(p)!.local, b)
    }
    return rigidCompose(rigidInverse(b), a)
  }

  /** Re-express a free vector (direction, force, velocity): rotation only. */
  vectorTo(v: Vec3, from: string, to: string): Vec3 {
    return rigidApplyDir(this.between(from, to), v)
  }

  /** Re-express a bound point: rotation and translation. */
  pointTo(p: Vec3, from: string, to: string): Vec3 {
    return rigidApply(this.between(from, to), p)
  }

  /**
   * Re-express a rank-2 tensor: A' = R A R^T.
   * Done in exactly one place. The naive bug this avoids is transforming only the
   * diagonal, which passes every axis-aligned test and fails everything else.
   */
  tensorTo(a: Mat3, from: string, to: string): Mat3 {
    const R = qToMat3(this.between(from, to).q)
    return mat3Mul(mat3Mul(R, a), mat3Transpose(R))
  }
}

export function mat3Mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0
      for (let k = 0; k < 3; k++) s += a[i * 3 + k]! * b[k * 3 + j]!
      o[i * 3 + j] = s
    }
  }
  return o
}

export const mat3Transpose = (a: Mat3): Mat3 =>
  [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!]

export const mat3Apply = (a: Mat3, v: Vec3): Vec3 => [
  a[0]! * v[0] + a[1]! * v[1] + a[2]! * v[2],
  a[3]! * v[0] + a[4]! * v[1] + a[5]! * v[2],
  a[6]! * v[0] + a[7]! * v[1] + a[8]! * v[2],
]

/**
 * Build a frame from an origin and two directions, Gram-Schmidt'd.
 * `x` is taken exactly; `up` only fixes the roll.
 */
export function frameFrom(origin: Vec3, x: Vec3, up: Vec3): Rigid {
  const ex = normalize(x)
  let ref = up
  if (Math.abs(dot(normalize(ref), ex)) > 1 - 1e-9) {
    // `up` is parallel to `x`; pick any other axis rather than failing.
    ref = Math.abs(ex[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
  }
  const ez = normalize(cross(ex, ref))
  const ey = cross(ez, ex)
  return { q: qFromMat3([ex[0], ey[0], ez[0], ex[1], ey[1], ez[1], ex[2], ey[2], ez[2]]), t: origin }
}

/** Shepperd's method: pick the largest-magnitude component to avoid cancellation. */
export function qFromMat3(m: Mat3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m as [number, number, number, number, number, number, number, number, number]
  const tr = m00 + m11 + m22
  let q: Quat
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]
  }
  return qNormalize(q)
}
