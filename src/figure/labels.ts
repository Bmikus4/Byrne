// LaTeX labels, typeset once and consumed three times.
//
// MathJax rather than KaTeX for exactly one reason: its SVG output jax emits glyph
// OUTLINES as <path> data. That single fact serves the viewport, the exported SVG and the
// exported PDF from one typesetting run, so a label cannot look different in the figure
// from how it looked on screen.
//
// The lite adaptor is a DOM-free JS implementation, so this module keeps `figure/`'s
// no-DOM rule.

import { mathjax } from 'mathjax-full/js/mathjax.js'
import { TeX } from 'mathjax-full/js/input/tex.js'
import { SVG } from 'mathjax-full/js/output/svg.js'
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js'
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js'
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js'

export interface Typeset {
  /** A complete <svg> element whose glyphs are <path> outlines. */
  readonly svg: string
  /** Advance width and height in ex units, as MathJax reports them. */
  readonly widthEx: number
  readonly heightEx: number
  /** Baseline offset in ex; negative means the box hangs below the baseline. */
  readonly verticalAlignEx: number
  /** True when MathJax was unavailable and this is a plain-text approximation. */
  readonly fallback: boolean
}

let doc: { convert(tex: string, opts: object): unknown } | undefined
let adaptor: { outerHTML(node: unknown): string; firstChild(node: unknown): unknown } | undefined
let initFailed = false

function init(): boolean {
  if (doc) return true
  if (initFailed) return false
  try {
    const a = liteAdaptor()
    RegisterHTMLHandler(a as never)
    adaptor = a as unknown as typeof adaptor
    doc = mathjax.document('', {
      InputJax: new TeX({ packages: AllPackages }),
      // `fontCache: 'none'` inlines every glyph path into each label. Larger files,
      // but each label is then a self-contained <svg> that survives being copied out
      // of the figure into a slide, which is what people actually do with them.
      OutputJax: new SVG({ fontCache: 'none' }),
    }) as unknown as typeof doc
    return true
  } catch {
    initFailed = true
    return false
  }
}

const cache = new Map<string, Typeset>()

const EX = 8.0        // points per ex at the figure's label size

export function typeset(latex: string): Typeset {
  const hit = cache.get(latex)
  if (hit) return hit
  const out = typesetUncached(latex)
  cache.set(latex, out)
  return out
}

function typesetUncached(latex: string): Typeset {
  if (init()) {
    try {
      const node = doc!.convert(latex, { display: false, em: 16, ex: EX, containerWidth: 1000 })
      const svg = adaptor!.outerHTML(adaptor!.firstChild(node))
      return {
        svg,
        widthEx: attrEx(svg, 'width'),
        heightEx: attrEx(svg, 'height'),
        verticalAlignEx: styleEx(svg),
        fallback: false,
      }
    } catch {
      // fall through to the text approximation
    }
  }
  const text = plain(latex)
  return {
    svg: `<text font-family="serif" font-style="italic" font-size="11">${escapeXml(text)}</text>`,
    widthEx: text.length * 0.6,
    heightEx: 1.4,
    verticalAlignEx: 0,
    fallback: true,
  }
}

function attrEx(svg: string, name: string): number {
  const m = new RegExp(`${name}="([-\\d.]+)ex"`).exec(svg)
  return m ? Number(m[1]) : 1
}

function styleEx(svg: string): number {
  const m = /vertical-align:\s*([-\d.]+)ex/.exec(svg)
  return m ? Number(m[1]) : 0
}

/** Strip TeX to something readable when MathJax is not available. Never silent. */
export function plain(latex: string): string {
  return latex
    .replace(/\\vec\{([^}]*)\}/g, '$1')
    .replace(/\\(alpha|beta|gamma|delta|theta|mu|phi|omega|rho|sigma|tau|lambda|pi)\b/g,
      (_m, g: string) => GREEK[g] ?? g)
    .replace(/[_^]\{([^}]*)\}/g, '$1')
    .replace(/[_^](\w)/g, '$1')
    .replace(/\\[a-zA-Z]+/g, '')
    .replace(/[{}]/g, '')
    .trim()
}

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ',
  mu: 'μ', phi: 'φ', omega: 'ω', rho: 'ρ', sigma: 'σ',
  tau: 'τ', lambda: 'λ', pi: 'π',
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export const EX_IN_POINTS = EX

/** MathJax runs with em = 16, so a label's fontSize (its em, in points) scales from that. */
export const EM_IN_POINTS = 16

export interface LabelPlacement {
  /** Top-left of the typeset box, and its size, in figure points. */
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
  /** MathJax's viewBox: x, y, width, height. Its y = 0 is the text baseline. */
  readonly vb: readonly [number, number, number, number]
}

/**
 * Where a label's typeset box goes. One function for SVG and PDF so the two cannot place
 * the same label differently. A `baseline` label puts its baseline on `at` and centres
 * horizontally, which is what keeps stacked lines on an even rhythm whatever their
 * ascenders and subscripts do.
 */
export function placeLabel(
  p: { at: readonly [number, number]; anchorX: number; anchorY: number; fontSize: number; baseline?: boolean },
  t: Typeset,
): LabelPlacement | undefined {
  const vbm = /viewBox="([-\d.\s]+)"/.exec(t.svg)
  if (!vbm) return undefined
  const vb = vbm[1]!.trim().split(/\s+/).map(Number) as [number, number, number, number]
  const k = p.fontSize / EM_IN_POINTS
  const w = t.widthEx * EX * k
  const h = t.heightEx * EX * k
  if (p.baseline) {
    return { x: p.at[0] - w / 2, y: p.at[1] - h * (-vb[1] / vb[3]), w, h, vb }
  }
  const gap = 4
  const x = p.at[0] + p.anchorX * gap - (p.anchorX > 0.2 ? 0 : p.anchorX < -0.2 ? w : w / 2)
  const y = p.at[1] - p.anchorY * gap - (p.anchorY > 0.2 ? h : p.anchorY < -0.2 ? 0 : h / 2)
  return { x, y, w, h, vb }
}
