// The interface's model layer, tested without a browser.
//
// Every interaction in the design document's §7.8 scripts is a list of operations, so
// the scripts are executable. These are those lists.

import { describe, expect, it } from 'vitest'
import { LIBRARY, EXAMPLES, useStore } from '../src/ui/store.js'
import {
  addEquilibrium, clearOverride, deleteObject, instantiate, operations,
  reexpressIn, setParameter, setProjectUnit, sumVectors,
} from '../src/ui/model.js'
import { lookup, numberOf } from '../src/core/scene.js'

const example = (name: string): string => {
  const key = Object.keys(EXAMPLES).find((k) => k.includes(name))!
  return EXAMPLES[key]!
}

function fresh(source: string) {
  const s = useStore.getState()
  s.setSource(source, false)
  return useStore.getState()
}

describe('the bundled library and examples', () => {
  it('loads the shipped components with no filesystem and no network', () => {
    expect(LIBRARY.size).toBeGreaterThan(12)
    expect(LIBRARY.has('std/mechanics/spring')).toBe(true)
    expect(LIBRARY.has('std/fields/point-charge')).toBe(true)
  })

  it('bundles every acceptance example', () => {
    for (const n of ['A-inclined', 'B-three', 'C-spring', 'D-point', 'E-frame']) {
      expect(Object.keys(EXAMPLES).some((k) => k.includes(n)), n).toBe(true)
    }
  })

  it('builds the first example on start', () => {
    expect(useStore.getState().built.scene).not.toBeNull()
  })
})

describe('the operation registry is the command palette', () => {
  it('exposes every action by name', () => {
    const ids = operations().map((o) => o.id)
    expect(ids).toContain('set-parameter')
    expect(ids).toContain('instantiate')
    expect(ids).toContain('extract-component')
    expect(ids).toContain('reexpress-in')
    expect(operations().every((o) => o.title.length > 0)).toBe(true)
  })
})

describe('interaction script A: inclined plane', () => {
  it('drags a ramp in, sets its angle, and reads the resultant', () => {
    fresh(example('A-inclined'))
    const s = () => useStore.getState()

    s().run(setParameter, { name: 'theta', expr: '45 deg' })
    const scene = s().built.scene!
    expect(numberOf(scene, lookup(scene, 'N.magnitude')))
      .toBeCloseTo(2 * 9.80665 * Math.cos(Math.PI / 4), 10)

    // Undo puts it back, exactly.
    s().undo()
    expect(numberOf(s().built.scene!, lookup(s().built.scene!, 'N.magnitude')))
      .toBeCloseTo(2 * 9.80665 * Math.cos(Math.PI / 6), 10)
    s().redo()
    expect(numberOf(s().built.scene!, lookup(s().built.scene!, 'N.magnitude')))
      .toBeCloseTo(2 * 9.80665 * Math.cos(Math.PI / 4), 10)
  })

  it('dropping a component from the palette instantiates it at a point', () => {
    fresh(example('A-inclined'))
    const before = useStore.getState().built.doc.nodes.length
    useStore.getState().run(instantiate, {
      component: 'std/mechanics/point-mass',
      at: 'vec(1.000 m, 0.000 m, 0.500 m)',
    })
    const after = useStore.getState().built
    expect(after.doc.nodes.length).toBe(before + 1)
    expect(after.scene).not.toBeNull()
    const added = after.doc.nodes.at(-1)!
    expect(added.kind).toBe('instance')
  })

  it('switching the project unit is an operation, and moves nothing', () => {
    fresh(example('A-inclined'))
    const before = Array.from(useStore.getState().built.scene!.values)
    useStore.getState().run(setProjectUnit, { dimension: 'length', unit: 'cm' })
    const after = useStore.getState().built
    expect(after.doc.project.units.length).toBe('cm')
    expect(Array.from(after.scene!.values)).toEqual(before)
  })
})

describe('interaction script: drop a frame on a quantity', () => {
  it('creates a NEW named object and destroys nothing', () => {
    fresh(example('E-frame'))
    const before = useStore.getState().built.doc.nodes.map((n) => ('name' in n ? n.name : ''))
    useStore.getState().run(reexpressIn, { target: 'vA', frame: 'B' })
    const after = useStore.getState().built
    const names = after.doc.nodes.map((n) => ('name' in n ? n.name : ''))
    expect(names.length).toBe(before.length + 1)
    for (const n of before) expect(names).toContain(n)
    expect(after.scene!.names.has('vA')).toBe(true)
  })
})

describe('interaction script: equilibrium on a body', () => {
  it('adds the constraints that impose it AND the check that reports it', () => {
    fresh(example('B-three'))
    const src = example('B-three')
      .replace(/constraint "balance_x".*\n/, '')
      .replace(/constraint "balance_y".*\n/, '')
      .replace(/check "bal"[\s\S]*?\n}\n/, '')
    fresh(src)
    const under = useStore.getState().built.scene!
    expect(under.report.verdict).toBe('under-constrained')
    expect(under.report.dof).toBe(2)

    useStore.getState().run(addEquilibrium, { body: 'ring', directions: ['world.x', 'world.y'] })
    const solved = useStore.getState().built.scene!
    expect(solved.report.verdict).toBe('well-constrained')
    expect(solved.report.dof).toBe(0)
    expect(numberOf(solved, lookup(solved, 'T3'))).toBeCloseTo(Math.sqrt(2100), 9)
    expect(solved.checkResults[0]!.pass).toBe(true)
  })
})

describe('overrides', () => {
  it('sets, marks and reverts an instance override', () => {
    fresh(example('C-spring'))
    useStore.getState().run(setParameter, { name: 's1.k', expr: '333 N/m' })
    let doc = useStore.getState().built.doc
    let s1 = doc.nodes.find((n) => n.kind === 'instance' && n.name === 's1')!
    expect((s1 as { params: Record<string, string> }).params.k).toBe('333 N/m')

    useStore.getState().run(clearOverride, { instance: 's1', field: 'k' })
    doc = useStore.getState().built.doc
    s1 = doc.nodes.find((n) => n.kind === 'instance' && n.name === 's1')!
    expect((s1 as { params: Record<string, string> }).params.k).toBeUndefined()
    // Reverting takes the definition default, which is 100 N/m.
    const scene = useStore.getState().built.scene!
    expect(numberOf(scene, lookup(scene, 's1.k'))).toBeCloseTo(100, 10)
  })
})

describe('bad input does not break the editor', () => {
  it('keeps the last good document and names the error', () => {
    fresh(example('A-inclined'))
    useStore.getState().setSource('param "a" "1 m"\nparam "b" "a + 1 s"')
    const built = useStore.getState().built
    expect(built.scene).toBeNull()
    expect(built.error).toMatch(/dimension mismatch/)
    // And the source is still editable back to something that builds.
    useStore.getState().setSource(example('A-inclined'))
    expect(useStore.getState().built.scene).not.toBeNull()
  })

  it('an operation that cannot apply reports rather than throwing', () => {
    fresh(example('A-inclined'))
    useStore.getState().run(deleteObject, { name: 'not-a-thing' })
    expect(useStore.getState().built.scene).not.toBeNull()
  })

  it('a resultant of a selection becomes a named object', () => {
    fresh(example('A-inclined'))
    useStore.getState().run(sumVectors, { of: ['W.force', 'N.force'] })
    const scene = useStore.getState().built.scene!
    expect([...scene.names.keys()].some((k) => k.startsWith('resultant'))).toBe(true)
  })
})
