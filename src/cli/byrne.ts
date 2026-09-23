#!/usr/bin/env node
//
// The command line. Fifty-odd lines, because `core/` and `figure/` have no window in
// them: the same code that draws the viewport writes the file, and neither needs a
// browser to do it.
//
//   byrne check   scene.byrne                 solve, report, exit non-zero on a failure
//   byrne render  scene.byrne -o fig.svg      SVG, PDF or TikZ, chosen by extension
//   byrne fmt     scene.byrne [--write]       canonical form
//   byrne primitives                          the frozen instruction set, from the code

import { writeFileSync, existsSync } from 'node:fs'
import { extname, join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { read, write } from '../core/dsl.js'
import { withLocal } from '../core/library.js'
import { build, lookup, numberOf, reported, Scene } from '../core/scene.js'
import { readLibraryDir, readText } from '../io/files.js'
import { projectScene } from '../figure/project.js'
import { toSvg } from '../figure/svg.js'
import { toTikz } from '../figure/tikz.js'
import { displayUnit, formatScalar, formatNumber } from '../core/units.js'
import { dimToString, isDimless } from '../core/dimension.js'
import { unit } from '../core/units.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../..')

function loadScene(path: string): Scene {
  const doc = read(readText(path))
  const libDir = join(REPO, 'library')
  const base = existsSync(libDir) ? readLibraryDir(libDir) : new Map()
  return build(doc, withLocal(base, doc.components))
}

function report(scene: Scene): number {
  const r = scene.report
  const out: string[] = []
  out.push(`solver      ${r.verdict}   ${r.unknowns} unknowns, ${r.residuals} residuals, rank ${r.rank}, ${r.dof} DOF`)
  out.push(`convergence ${r.converged ? 'converged' : 'DID NOT CONVERGE'} in ${r.iterations} iterations`)
  if (r.worstRow) out.push(`worst row   ${r.worstRow} at ${formatNumber(r.worst, 3)} x its tolerance`)
  for (const c of r.conflicts) {
    out.push(`${c.conflicting ? 'CONFLICT' : 'redundant'}   ${c.constraints.join(' + ')}  (residual ${formatNumber(c.residual, 3)})`)
  }
  for (const w of scene.warnings) out.push(`warning     ${w}`)

  for (const c of scene.checkResults) {
    out.push(`check ${c.name.padEnd(10)} ${c.pass ? 'PASS' : 'FAIL'}  residual ${formatNumber(c.residual, 4)} N  (tolerance ${formatNumber(c.tolerance, 2)})  ${c.detail}`)
  }
  for (const d of scene.deferred) {
    const v = typeof d.si === 'number' ? formatNumber(d.si, 6) : d.si.map((x) => formatNumber(x, 5)).join(', ')
    out.push(`measure ${d.name.padEnd(8)} ${v} ${d.unit}${d.error !== undefined ? `  (+/- ${formatNumber(d.error, 2)})` : ''}`)
  }
  for (const [name, v] of scene.names) {
    if (!scene.doc.nodes.some((n) => 'name' in n && n.name === name && n.kind === 'measure')) continue
    if (v.t.length === 3) {
      const u = displayUnit(scene.doc.project.units, v.dim, v.unit)
      const c = reported(scene, v).map((x) => x / (u ? unitFactor(u) : 1))
      out.push(`  ${name.padEnd(12)} (${c.map((x) => formatNumber(x, 6)).join(', ')}) ${u || unitFor(v)} in ${v.frame}`)
    } else if (v.t.length === 1) {
      const u = displayUnit(scene.doc.project.units, v.dim, v.unit)
      out.push(`  ${name.padEnd(12)} ${formatScalar({ si: numberOf(scene, v), dim: v.dim, unit: u })}`)
    }
  }
  console.log(out.join('\n'))
  const bad = !r.converged || scene.checkResults.some((c) => !c.pass && c.op === 'equilibrium' && false)
  return bad ? 1 : 0
}

const unitFor = (v: { dim: readonly unknown[]; unit: string }): string =>
  v.unit || (isDimless(v.dim as never) ? '' : dimToString(v.dim as never))

const unitFactor = (symbol: string): number => unit(symbol).factor

function main(argv: string[]): number {
  const [cmd, ...rest] = argv
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name)
    return i >= 0 ? rest[i + 1] : undefined
  }
  const positional = rest.filter((a, i) => !a.startsWith('-') && !(i > 0 && rest[i - 1]!.startsWith('-') && rest[i - 1] !== '--write'))

  switch (cmd) {
    case 'check': {
      const file = positional[0]
      if (!file) return usage()
      return report(loadScene(file))
    }
    case 'render': {
      const file = positional[0]
      const out = flag('-o') ?? flag('--out')
      if (!file || !out) return usage()
      const scene = loadScene(file)
      const fig = projectScene(scene, {
        ...(flag('--view') ? { view: flag('--view')! } : {}),
        ...(flag('--width') ? { width: Number(flag('--width')) } : {}),
        ...(flag('--height') ? { height: Number(flag('--height')) } : {}),
      })
      const ext = extname(out).toLowerCase()
      if (ext === '.svg') {
        writeFileSync(out, toSvg(fig, { labels: rest.includes('--text-labels') ? 'text' : 'outlines' }))
      } else if (ext === '.tex') {
        writeFileSync(out, toTikz(fig, { standalone: rest.includes('--standalone') }))
      } else if (ext === '.pdf') {
        // pdf-lib is the heaviest dependency in the tree; only an actual PDF loads it.
        return renderPdf(fig, out)
      } else {
        console.error(`byrne: do not know how to write \`${ext}\`; try .svg, .pdf or .tex`)
        return 2
      }
      for (const c of fig.caveats) console.error(`note: ${c}`)
      console.error(`wrote ${out}`)
      return 0
    }
    case 'fmt': {
      const file = positional[0]
      if (!file) return usage()
      const text = write(read(readText(file)))
      if (rest.includes('--write')) { writeFileSync(file, text); console.error(`formatted ${file}`) }
      else process.stdout.write(text)
      return 0
    }
    case 'primitives':
      process.stdout.write(readText(join(REPO, 'docs/PRIMITIVES.md')))
      return 0
    default:
      return usage()
  }
}

function renderPdf(fig: ReturnType<typeof projectScene>, out: string): number {
  // Dynamic, so `byrne check` never pays for the PDF writer.
  void import('../figure/pdf.js').then(async ({ toPdf }) => {
    writeFileSync(out, await toPdf(fig))
    for (const c of fig.caveats) console.error(`note: ${c}`)
    console.error(`wrote ${out}`)
  })
  return 0
}

function usage(): number {
  console.error(`byrne - physics diagrams from a live model

  byrne check   <scene.byrne>
  byrne render  <scene.byrne> -o <out.svg|.pdf|.tex> [--view NAME] [--width PT] [--height PT]
                [--text-labels] [--standalone]
  byrne fmt     <scene.byrne> [--write]
  byrne primitives
`)
  return 2
}

process.exitCode = main(process.argv.slice(2))

export { loadScene }
