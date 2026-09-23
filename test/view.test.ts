// The view arithmetic: camera axis, construction plane and navigation cube are one fact.
//
// These are the bugs this file exists to catch, both of which were real:
//
//   * The grid was rotated onto a different plane from the one the plane indicator drew,
//     so the viewport told you two different things about where you were drawing.
//   * The cube face you clicked and the plane you got could disagree, because each was
//     derived separately.

import { describe, expect, it } from 'vitest'
import {
  AXES, BOX_FACE_ORDER, DEFAULT_AXIS, axisDeviation, axisVector, axisView,
  gridRotation, nearestAxis, planeNormal, planeRotation, snapInPlane, dragToOrbit,
} from '../src/ui/view.js'

/** Apply an XYZ Euler rotation to a vector, the way three.js does. */
function euler(v: readonly [number, number, number], r: readonly [number, number, number]): [number, number, number] {
  let [x, y, z] = v
  const [rx, ry, rz] = r
  let c = Math.cos(rx), s = Math.sin(rx)
  ;[y, z] = [y * c - z * s, y * s + z * c]
  c = Math.cos(ry); s = Math.sin(ry)
  ;[x, z] = [x * c + z * s, -x * s + z * c]
  c = Math.cos(rz); s = Math.sin(rz)
  ;[x, y] = [x * c - y * s, x * s + y * c]
  return [x, y, z]
}

const near = (a: readonly number[], b: readonly number[]): void => {
  for (let i = 0; i < 3; i++) expect(Math.abs(a[i]! - b[i]!)).toBeLessThan(1e-12)
}

describe('view axes', () => {
  it('opens looking down -y, which is the vertical plane a physics diagram lives in', () => {
    expect(DEFAULT_AXIS).toBe('-y')
    expect(axisView(DEFAULT_AXIS).plane).toBe('zx')
    near(axisView(DEFAULT_AXIS).up, [0, 0, 1])
  })

  it('gives every axis a plane perpendicular to it', () => {
    for (const a of AXES) {
      const v = axisView(a)
      near(planeNormal(v.plane), [
        Math.abs(axisVector(a)[0]), Math.abs(axisVector(a)[1]), Math.abs(axisVector(a)[2]),
      ])
    }
  })

  it('never has up parallel to the view direction', () => {
    for (const a of AXES) {
      const v = axisView(a)
      const d = v.eye[0] * v.up[0] + v.eye[1] * v.up[1] + v.eye[2] * v.up[2]
      expect(Math.abs(d), a).toBeLessThan(1e-12)
    }
  })

  it('finds the nearest axis to a free direction', () => {
    expect(nearestAxis([0.1, -0.9, 0.2])).toBe('-y')
    expect(nearestAxis([0.9, 0.1, 0.2])).toBe('+x')
    expect(nearestAxis([0, 0, -1])).toBe('-z')
    expect(axisDeviation([0, 0, -1])).toBeCloseTo(0, 12)
    expect(axisDeviation([1, 1, 0])).toBeCloseTo(Math.PI / 4, 12)
  })
})

describe('the grid and the plane indicator agree', () => {
  // A three.js GridHelper lies in XZ (normal +Y); a PlaneGeometry lies in XY (normal +Z).
  // The two rotations therefore differ, and getting one of them wrong is invisible until
  // you notice the grid is not the plane you are drawing on.
  it('rotates the grid onto the plane it claims', () => {
    for (const plane of ['xy', 'zx', 'yz'] as const) {
      const got = euler([0, 1, 0], gridRotation(plane))
      const want = planeNormal(plane)
      near(got.map(Math.abs), want.map(Math.abs))
    }
  })

  it('rotates a plane mesh onto the same plane', () => {
    for (const plane of ['xy', 'zx', 'yz'] as const) {
      const got = euler([0, 0, 1], planeRotation(plane))
      const want = planeNormal(plane)
      near(got.map(Math.abs), want.map(Math.abs))
    }
  })
})

describe('snapping stays in the plane', () => {
  it('rounds the two in-plane axes and leaves the normal alone', () => {
    const p = [0.123, 0.456, 0.789] as const
    near(snapInPlane(p, 'zx', 0.1), [0.1, 0.456, 0.8])
    near(snapInPlane(p, 'xy', 0.1), [0.1, 0.5, 0.789])
    near(snapInPlane(p, 'yz', 0.1), [0.123, 0.5, 0.8])
  })

  it('does nothing when snapping is off', () => {
    near(snapInPlane([0.123, 0.456, 0.789], 'zx', 0), [0.123, 0.456, 0.789])
  })
})

describe('the navigation cube', () => {
  it('names its faces in the order three.js builds a box', () => {
    expect([...BOX_FACE_ORDER]).toEqual(['+x', '-x', '+y', '-y', '+z', '-z'])
    expect([...BOX_FACE_ORDER].sort()).toEqual([...AXES].sort())
  })

  it('turns a drag into an orbit that reverses with the drag', () => {
    const a = dragToOrbit(10, 0)
    const b = dragToOrbit(-10, 0)
    expect(a.yaw).toBeCloseTo(-b.yaw, 15)
    expect(dragToOrbit(0, 0)).toEqual({ yaw: -0, pitch: -0 })
  })
})
