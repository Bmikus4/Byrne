// Label text: what a person types, turned into the LaTeX the figure pipeline typesets.
//
// The markup is the least a chart needs: `$...$` is maths, `**...**` is bold, a newline is
// a new line. Text runs go into \textsf{} so the face matches the sans-serif source charts;
// characters LaTeX treats as commands go OUTSIDE \textsf as maths (`\#`, `\%`, ...) because
// that one spelling is valid in both MathJax and real LaTeX, so the TikZ export compiles
// from the same string the screen typeset.

import { EM_IN_POINTS as EM_BASE, EX_IN_POINTS, typeset } from '../figure/labels.js'

const SPECIAL: Record<string, string> = {
  '\\': '\\backslash', '{': '\\{', '}': '\\}', '#': '\\#', '%': '\\%', '&': '\\&',
  '_': '\\_', '~': '\\sim', '^': '\\hat{}', '<': '<', '>': '>', '|': '|',
}

// Bold sans is \boldsymbol{\mathsf{}}: MathJax's \textsf{\textbf{}} falls back to SERIF
// bold, and that was measured, not assumed. It is maths mode, so spaces and the
// punctuation maths would space as operators are spelled out.
const MATH_TEXT: Record<string, string> = {
  ' ': '\\ ', '-': '\\text{-}', ':': '{:}', ',': '{,}', ';': '{;}', '!': '{!}',
  "'": '\\text{\u2019}', '\u2019': '\\text{\u2019}', '\u2018': '\\text{\u2018}',
  '\u201c': '\\text{\u201c}', '\u201d': '\\text{\u201d}', '\u2014': '\\text{\u2014}', '\u2013': '\\text{\u2013}',
}

function boldSans(s: string): string {
  let out = ''
  for (const ch of s) out += MATH_TEXT[ch] ?? ch
  return `\\boldsymbol{\\mathsf{${out}}}`
}

function textRun(s: string, bold: boolean): string {
  let out = ''
  let buf = ''
  const flush = (): void => {
    if (buf) out += bold ? boldSans(buf) : `\\textsf{${buf}}`
    buf = ''
  }
  for (const ch of s) {
    const m = SPECIAL[ch]
    if (m) { flush(); out += bold && m.startsWith('\\') && m.length > 2 ? `\\boldsymbol{${m}}` : m }
    else buf += ch
  }
  flush()
  return out
}

/** One line of markup to LaTeX. `bold` is the state the line starts in. */
export function toLatex(line: string, bold = false): string {
  let out = ''
  let b = bold
  let i = 0
  while (i < line.length) {
    if (line[i] === '$') {
      const j = line.indexOf('$', i + 1)
      if (j > i) {
        const math = line.slice(i + 1, j)
        out += b ? `\\boldsymbol{${math}}` : `{${math}}`
        i = j + 1
        continue
      }
      // A `$` with no partner is a literal dollar. This branch must consume it: the run
      // scanner below stops AT a `$`, so leaving it would loop forever on half-typed maths.
      out += '\\$'
      i++
      continue
    }
    if (line.startsWith('**', i)) { b = !b; i += 2; continue }
    let j = i
    while (j < line.length && line[j] !== '$' && !line.startsWith('**', j)) j++
    out += textRun(line.slice(i, j), b)
    i = j
  }
  return out || '\\textsf{}'
}

/** Is the text bold at the end of this markup, given the state it started in? */
function boldAfter(s: string, bold: boolean): boolean {
  let b = bold
  let inMath = false
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '$') inMath = !inMath
    else if (!inMath && s.startsWith('**', i)) { b = !b; i++ }
  }
  return b
}

export function widthPt(latex: string, size: number): number {
  return typeset(latex).widthEx * EX_IN_POINTS * (size / EM_BASE)
}

let spaceEm: number | undefined
function spaceWidth(size: number): number {
  spaceEm ??= (typeset('\\textsf{a a}').widthEx - typeset('\\textsf{aa}').widthEx) * EX_IN_POINTS / EM_BASE
  return spaceEm * size
}

/** Split a paragraph into words, keeping each $...$ whole. */
function words(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inMath = false
  for (const ch of s) {
    if (ch === '$') inMath = !inMath
    if (ch === ' ' && !inMath) { if (cur) out.push(cur); cur = '' }
    else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export interface Line {
  readonly latex: string
  readonly w: number
  readonly size: number
  readonly color: string
  /** Space this line takes above and below its baseline, in points. */
  readonly above: number
  readonly below: number
}

/** Lay out one field: explicit newlines always break; `maxW` (points) wraps if given. */
export function layoutField(
  text: string, size: number, color: string, opts: { bold?: boolean; maxW?: number } = {},
): Line[] {
  const out: Line[] = []
  for (const para of text.split('\n')) {
    const startBold = opts.bold ?? false
    if (!opts.maxW) {
      const latex = toLatex(para, startBold)
      out.push(measure(latex, size, color))
      continue
    }
    const ws = words(para)
    if (!ws.length) { out.push({ latex: '\\textsf{}', w: 0, size, color, ...plainSpace(size) }); continue }
    let line: string[] = []
    let lineW = 0
    let b = startBold
    let lineBold = b
    const sp = spaceWidth(size)
    const emit = (): void => {
      const raw = line.join(' ')
      const latex = toLatex(raw, lineBold)
      out.push(measure(latex, size, color))
      lineBold = boldAfter(raw, lineBold)
    }
    for (const w of ws) {
      const ww = widthPt(toLatex(w, b), size)
      if (line.length && lineW + sp + ww > opts.maxW) {
        emit()
        line = []
        lineW = 0
      }
      lineW += (line.length ? sp : 0) + ww
      line.push(w)
      b = boldAfter(w, b)
    }
    if (line.length) emit()
  }
  return out
}

export const NOTE_GREY = '#5f5f69'
export const lineHeight = (size: number): number => size * 1.28

/** The rhythm a plain line of text gets; a line with a fraction or a tall symbol gets more. */
const plainSpace = (size: number): { above: number; below: number } => ({ above: size * 0.98, below: size * 0.3 })

function measure(latex: string, size: number, color: string): Line {
  const t = typeset(latex)
  const k = (EX_IN_POINTS * size) / EM_BASE
  const vb = /viewBox="([-\d.\s]+)"/.exec(t.svg)?.[1]?.trim().split(/\s+/).map(Number)
  const h = t.heightEx * k
  const asc = vb ? h * (-vb[1]! / vb[3]!) : h * 0.75
  const base = plainSpace(size)
  return {
    latex, w: t.widthEx * k, size, color,
    above: Math.max(base.above, asc + size * 0.22),
    below: Math.max(base.below, h - asc + size * 0.12),
  }
}

export interface Block {
  readonly lines: Line[]
  readonly w: number
  readonly h: number
}

/** Title (bold), text, then note (smaller, grey): the three-tier label of the source charts. */
export function layoutBlock(
  f: { title: string; text: string; note: string; size: number; color: string }, maxW?: number,
): Block {
  const lines: Line[] = []
  if (f.title) lines.push(...layoutField(f.title, f.size, f.color, { bold: true, maxW }))
  if (f.text) lines.push(...layoutField(f.text, f.size, f.color, { maxW }))
  if (f.note) lines.push(...layoutField(f.note, Math.max(5, f.size - 1), NOTE_GREY, { maxW }))
  const w = lines.reduce((m, l) => Math.max(m, l.w), 0)
  const h = lines.reduce((s, l) => s + l.above + l.below, 0)
  return { lines, w, h }
}
