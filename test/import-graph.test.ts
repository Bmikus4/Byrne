// The architectural rule, enforced rather than promised.
//
// `core/` holds the model and `figure/` holds the export pipeline. Neither may reach a
// DOM, a filesystem, or a GPU. Two things follow, and they are the reason the rule is
// worth a test: every acceptance example runs headless, and a screenshot cannot be
// exported as vector output even by accident, because there is no rasteriser reachable
// from the code that writes the file.

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ROOT } from './helpers.js'

function sources(dir: string): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  const walk = (d: string): void => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (['.ts', '.tsx'].includes(extname(p))) {
        out.push({ path: p.slice(ROOT.length + 1).replace(/\\/g, '/'), text: readFileSync(p, 'utf8') })
      }
    }
  }
  walk(dir)
  return out
}

const importsOf = (text: string): string[] =>
  [...text.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!)
    .concat([...text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!))
    .concat([...text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!))

const FORBIDDEN_MODULES = [
  /^node:fs/, /^node:path/, /^node:child_process/, /^node:http/, /^node:net/,
  /^fs$/, /^path$/,
  /^three/, /^react/, /^react-dom/, /^zustand/,
]

const FORBIDDEN_GLOBALS = [
  /\bdocument\s*\./, /\bwindow\s*\./, /\bnavigator\s*\./,
  /\bHTMLCanvasElement\b/, /\bgetContext\(/, /\bWebGL/,
  /\bfetch\s*\(/, /\bXMLHttpRequest\b/,
]

describe('the core is a model, not an application', () => {
  const core = sources(join(ROOT, 'src/core'))
  const figure = sources(join(ROOT, 'src/figure'))

  it('has files to check', () => {
    expect(core.length).toBeGreaterThan(8)
    expect(figure.length).toBeGreaterThan(4)
  })

  it.each([...core, ...figure])('$path imports nothing that touches a machine', ({ path, text }) => {
    for (const spec of importsOf(text)) {
      for (const bad of FORBIDDEN_MODULES) {
        expect(bad.test(spec), `${path} imports ${spec}`).toBe(false)
      }
    }
  })

  it.each([...core, ...figure])('$path reaches no host global', ({ path, text }) => {
    // Comments are stripped first: the rule is about what the code does, and the
    // explanations of it necessarily name the things it must not touch.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '')
    for (const bad of FORBIDDEN_GLOBALS) {
      expect(bad.test(code), `${path} matches ${bad}`).toBe(false)
    }
  })

  it('keeps the rasteriser out of the export path entirely', () => {
    const all = sources(join(ROOT, 'src/figure'))
      .map((f) => f.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, ''))
      .join('\n')
    expect(all).not.toMatch(/canvas|toDataURL|ImageData|putImageData|drawImage/i)
  })

  it('confines filesystem access to src/io', () => {
    const io = sources(join(ROOT, 'src/io'))
    expect(io.some((f) => /node:fs/.test(f.text))).toBe(true)
    for (const f of [...core, ...figure]) {
      expect(f.text, f.path).not.toMatch(/node:fs/)
    }
  })

  it('makes no network call anywhere in the product', () => {
    const all = [...sources(join(ROOT, 'src'))].filter((f) => !f.path.includes('/ui/'))
    for (const f of all) {
      expect(f.text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, ''), f.path)
        .not.toMatch(/\bfetch\(|axios|node-fetch|https?:\/\/(?!www\.w3\.org)/)
    }
  })
})
