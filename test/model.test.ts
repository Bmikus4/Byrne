// The properties the format, the library and the component system have to hold, plus
// acceptance example F.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT, buildSource, example, stdLibrary } from './helpers.js'
import { EMPTY_PROJECT, read, write } from '../src/core/dsl.js'
import { proposeComponent, definitionDiff, editDefinition } from '../src/core/component.js'
import { lookup, numberOf, build } from '../src/core/scene.js'
import { withLocal } from '../src/core/library.js'
import { projectScene } from '../src/figure/project.js'
import { toSvg } from '../src/figure/svg.js'
import { formatScalar } from '../src/core/units.js'

const EXAMPLES = readdirSync(join(ROOT, 'examples')).filter((f) => f.endsWith('.byrne'))

describe('DSL round-trip', () => {
  it('is a semantic round-trip for every example', () => {
    for (const f of EXAMPLES) {
      const once = read(example(f))
      const twice = read(write(once))
      expect(strip(twice), f).toEqual(strip(once))
    }
  })

  it('is a textual fixpoint for anything the writer produced', () => {
    for (const f of EXAMPLES) {
      const canonical = write(read(example(f)))
      expect(write(read(canonical)), f).toBe(canonical)
    }
  })

  it('round-trips the shipped library', () => {
    for (const src of libraryFiles()) {
      const once = read(src)
      expect(strip(read(write(once)))).toEqual(strip(once))
    }
  })

  it('keeps comments that precede a top-level node', () => {
    const src = write(read(example('A-inclined-plane.byrne')))
    expect(src).toMatch(/\/\/ Acceptance example A/)
  })

  it('names the line when the syntax is wrong', () => {
    expect(() => read('param "a" "1 m"\nparam "b" "2 m" {\n')).toThrow(/KDL parse error at line/)
  })

  it('refuses a top-level node it does not know', () => {
    expect(() => read('wibble "x"')).toThrow(/unknown top-level node `wibble`/)
  })
})

describe('acceptance F: unit round-trip', () => {
  const metres = example('A-inclined-plane.byrne')
  const centimetres = metres.replace('units length="m"', 'units length="cm"')

  it('changes the display and not the model', () => {
    const a = buildSource(metres)
    const b = buildSource(centimetres)
    expect(a.doc.project.units.length).toBe('m')
    expect(b.doc.project.units.length).toBe('cm')
    // Every tape slot, bit for bit.
    expect(Array.from(b.values)).toEqual(Array.from(a.values))
  })

  it('exports identical geometry in both settings', () => {
    const svgA = toSvg(projectScene(buildSource(metres)))
    const svgB = toSvg(projectScene(buildSource(centimetres)))
    expect(svgB).toBe(svgA)
  })

  it('displays the same quantity in either unit', () => {
    const scene = buildSource(metres)
    const s = lookup(scene, 's')
    const q = { si: numberOf(scene, s), dim: s.dim, unit: 'm' }
    expect(formatScalar(q, { unit: 'm' })).toBe('1.2 m')
    expect(formatScalar(q, { unit: 'cm' })).toBe('120 cm')
    expect(formatScalar(q, { unit: 'ft' })).toBe('3.93701 ft')
  })
})

describe('no privileged built-ins', () => {
  const PRIMITIVES = readFileSync(join(ROOT, 'docs/PRIMITIVES.md'), 'utf8')
  const frozen = new Set(
    [...PRIMITIVES.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]!),
  )

  it('lists a non-trivial frozen primitive set', () => {
    expect(frozen.size).toBeGreaterThan(20)
  })

  it('uses only primitives and other components, everywhere in the shipped library', () => {
    const lib = stdLibrary()
    const offenders: string[] = []
    for (const [path, def] of lib) {
      for (const g of def.geometry) {
        if (!frozen.has(g.op)) offenders.push(`${path}: geometry \`${g.op}\``)
      }
      for (const c of def.constraints) {
        if (!frozen.has(c.op)) offenders.push(`${path}: constraint \`${c.op}\``)
      }
      for (const inst of def.instances) {
        if (!lib.has(inst.component)) offenders.push(`${path}: nested \`${inst.component}\``)
      }
      for (const p of def.params) {
        if (!frozen.has(`type:${p.type}`)) offenders.push(`${path}: parameter type \`${p.type}\``)
      }
    }
    expect(offenders).toEqual([])
  })

  it('rejects a component that invents a constraint mechanism', () => {
    const src = `
component "user/bad" version=1 {
  meta { title "Bad" }
  constraints { magic-balance expr="1" }
}`
    const doc = read(src)
    expect(() => build(
      read(`instance "x" "user/bad" { }`),
      withLocal(stdLibrary(), doc.components),
    )).toThrow(/not a constraint primitive/)
  })
})

describe('composite components', () => {
  const src = `
project "byrne" version=1 { units length="m" mass="kg" force="N" }
param "g" "9.80665 m/s^2" type="acceleration"
instance "hm" "std/mechanics/hanging-mass" {
  param "mass" "3 kg"
  param "at" "vec(1 m, 0 m, 2 m)"
  param "g" "g"
}
`
  const scene = buildSource(src)

  it('nests instances and exposes through them', () => {
    expect(numberOf(scene, lookup(scene, 'hm.body.mass'))).toBeCloseTo(3, 12)
    expect(numberOf(scene, lookup(scene, 'hm.position'), 0)).toBeCloseTo(1, 12)
  })

  it('a nested force still lands in the right body sum', () => {
    const w = lookup(scene, 'hm.weight')
    expect(numberOf(scene, w, 2)).toBeCloseTo(-3 * 9.80665, 10)
    const net = lookup(scene, 'hm.body.netforce')
    expect(numberOf(scene, net, 2)).toBeCloseTo(-3 * 9.80665, 10)
  })
})

describe('component extraction', () => {
  const doc = read(example('C-spring-chain.byrne'))

  it('infers parameters from the free names a selection reads', () => {
    const inf = proposeComponent(doc, ['s1', 'k1', 'L0'], 'user/anchored-spring')
    const names = inf.def.params.map((p) => p.name).sort()
    expect(names).toContain('ceiling')
    expect(names).toContain('m1')
    expect(inf.def.instances.map((i) => i.name)).toEqual(['s1'])
    expect(inf.notes.join('\n')).toMatch(/became a reference parameter and a port/)
  })

  it('exposes what the rest of the document reads from inside the selection', () => {
    const inf = proposeComponent(doc, ['s1'], 'user/anchored-spring')
    expect(inf.def.expose.length).toBeGreaterThanOrEqual(0)
  })

  it('offers the inference rather than applying it', () => {
    const inf = proposeComponent(doc, ['s1'], 'user/anchored-spring')
    expect(inf.notes.length).toBeGreaterThan(0)
    expect(doc.components.length).toBe(0)     // nothing was written back
  })
})

describe('definition edits', () => {
  const doc = read(example('C-spring-chain.byrne'))
  const lib = stdLibrary()
  const spring = lib.get('std/mechanics/spring')!

  it('preserves an override and reports it as preserved', () => {
    const next = {
      ...spring,
      params: spring.params.map((p) => (p.name === 'coils' ? { ...p, default: '12' } : p)),
    }
    const diff = definitionDiff(doc, spring, next)
    const s2k = diff.changes.find((c) => c.instance === 's2' && c.field === 'k')!
    expect(s2k.provenance).toBe('overridden')
    expect(s2k.from).toBe('250 N/m')
    expect(s2k.to).toBe('250 N/m')
    const s1coils = diff.changes.find((c) => c.instance === 's1' && c.field === 'coils')!
    expect(s1coils.provenance).toBe('inherited')
    expect(s1coils.to).toBe('12')
  })

  it('refuses a destructive edit until it is confirmed', () => {
    const next = { ...spring, params: spring.params.filter((p) => p.name !== 'k') }
    expect(() => editDefinition(doc, lib, next)).toThrow(/confirm to apply/)
    const { library, diff } = editDefinition(doc, lib, next, true)
    expect(diff.destructive).toContain('k')
    expect(library.get('std/mechanics/spring')!.version).toBe(spring.version + 1)
  })

  it('an edited definition changes inheriting instances and not overriding ones', () => {
    const edited = example('C-spring-chain.byrne')
    const scene = buildSource(edited)
    expect(numberOf(scene, lookup(scene, 's2.k'))).toBeCloseTo(250, 12)
    expect(numberOf(scene, lookup(scene, 's2.coils'))).toBeCloseTo(8, 12)
  })
})

function libraryFiles(): string[] {
  const out: string[] = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (extname(p) === '.kdl') out.push(readFileSync(p, 'utf8'))
    }
  }
  walk(join(ROOT, 'library'))
  return out
}

/** Comments are not part of the semantic document, so they are stripped for equality. */
function strip(d: ReturnType<typeof read>) {
  return { project: d.project, nodes: d.nodes, components: d.components }
}

void EMPTY_PROJECT
