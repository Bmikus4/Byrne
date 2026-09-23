// The type lattice and the value union.
//
// A TYPE is a triple: kind x dimension x frame. Assignability is equality on all three,
// with two documented exceptions (direction -> vector, integer -> scalar). There is no
// coercion. A vector in frame A and a vector in frame B do not add; that is the whole
// point of the tool.

import { Dim, DIMLESS, dimEq, dimToString, isDimless } from './dimension.js'
import { Mat3, Vec3, V0 } from './frame.js'

export type Kind =
  | 'scalar' | 'integer' | 'boolean'
  | 'vector' | 'direction' | 'point' | 'tensor2'
  | 'frame' | 'curve' | 'surface' | 'body'

export interface Type {
  readonly kind: Kind
  readonly dim: Dim
  /** `none` for scalars and booleans; a frame id otherwise. */
  readonly frame: string | 'none'
}

export const T = (kind: Kind, dim: Dim = DIMLESS, frame: string | 'none' = 'none'): Type =>
  ({ kind, dim, frame })

export function typeToString(t: Type): string {
  const d = isDimless(t.dim) ? '' : `<${dimToString(t.dim)}>`
  const f = t.frame === 'none' ? '' : ` in ${t.frame}`
  return `${t.kind}${d}${f}`
}

/** Assignability. The two exceptions are here and nowhere else. */
export function assignable(from: Type, to: Type): boolean {
  if (from.kind === to.kind && dimEq(from.dim, to.dim) && from.frame === to.frame) return true
  if (from.kind === 'direction' && to.kind === 'vector' && isDimless(to.dim) && from.frame === to.frame) return true
  if (from.kind === 'integer' && to.kind === 'scalar' && isDimless(to.dim)) return true
  return false
}

export type Value =
  | { readonly k: 'scalar'; readonly si: number; readonly dim: Dim; readonly unit: string }
  | { readonly k: 'integer'; readonly si: number }
  | { readonly k: 'boolean'; readonly v: boolean }
  | { readonly k: 'vector'; readonly si: Vec3; readonly dim: Dim; readonly frame: string; readonly unit: string }
  | { readonly k: 'direction'; readonly si: Vec3; readonly frame: string }
  | { readonly k: 'point'; readonly si: Vec3; readonly dim: Dim; readonly frame: string; readonly unit: string }
  | { readonly k: 'tensor2'; readonly si: Mat3; readonly dim: Dim; readonly frame: string }
  | { readonly k: 'frame'; readonly id: string }

export const vScalar = (si: number, dim: Dim = DIMLESS, unit = ''): Value =>
  ({ k: 'scalar', si, dim, unit })
export const vInt = (si: number): Value => ({ k: 'integer', si })
export const vBool = (v: boolean): Value => ({ k: 'boolean', v })
export const vVector = (si: Vec3, dim: Dim, frame: string, unit = ''): Value =>
  ({ k: 'vector', si, dim, frame, unit })
export const vDirection = (si: Vec3, frame: string): Value => ({ k: 'direction', si, frame })
export const vPoint = (si: Vec3, dim: Dim, frame: string, unit = ''): Value =>
  ({ k: 'point', si, dim, frame, unit })
export const vTensor = (si: Mat3, dim: Dim, frame: string): Value => ({ k: 'tensor2', si, dim, frame })
export const vFrame = (id: string): Value => ({ k: 'frame', id })

export function typeOf(v: Value): Type {
  switch (v.k) {
    case 'scalar': return T('scalar', v.dim)
    case 'integer': return T('integer')
    case 'boolean': return T('boolean')
    case 'vector': return T('vector', v.dim, v.frame)
    case 'direction': return T('direction', DIMLESS, v.frame)
    case 'point': return T('point', v.dim, v.frame)
    case 'tensor2': return T('tensor2', v.dim, v.frame)
    case 'frame': return T('frame')
  }
}

/** Numeric components of a value, for display and for residual assembly. */
export function components(v: Value): number[] {
  switch (v.k) {
    case 'scalar': case 'integer': return [v.si]
    case 'boolean': return [v.v ? 1 : 0]
    case 'vector': case 'direction': case 'point': return [...v.si]
    case 'tensor2': return [...v.si]
    case 'frame': return []
  }
}

export const ZEROV: Vec3 = V0
