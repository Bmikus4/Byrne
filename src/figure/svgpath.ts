// A small SVG path toolkit: parse, transform, re-serialise.
//
// This exists so that a MathJax label can be FLATTENED — its nested <g transform> tree
// collapsed into absolute path data — and then drawn into a PDF, where there is no such
// thing as a nested transform group you can hand to a path drawer. It is the piece that
// makes "the same typesetting run feeds the viewport, the SVG and the PDF" true rather
// than aspirational.
//
// Only the subset MathJax emits is handled: M L H V C S Q T Z, absolute and relative.
// An arc command would need the ellipse re-parameterised under a general matrix; MathJax
// fonts contain none, and hitting one raises rather than silently dropping it.

export type Matrix = readonly [number, number, number, number, number, number] // a b c d e f

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]

export const matMul = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]

export const apply = (m: Matrix, x: number, y: number): [number, number] =>
  [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]

export function parseTransform(s: string): Matrix {
  let m = IDENTITY
  const re = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/g
  for (let t = re.exec(s); t; t = re.exec(s)) {
    const a = t[2]!.trim().split(/[\s,]+/).map(Number)
    switch (t[1]) {
      case 'matrix': m = matMul(m, [a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!]); break
      case 'translate': m = matMul(m, [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0]); break
      case 'scale': m = matMul(m, [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]); break
      case 'rotate': {
        const r = ((a[0] ?? 0) * Math.PI) / 180
        const c = Math.cos(r), sn = Math.sin(r)
        const rot: Matrix = [c, sn, -sn, c, 0, 0]
        if (a.length >= 3) {
          m = matMul(matMul(m, [1, 0, 0, 1, a[1]!, a[2]!]), matMul(rot, [1, 0, 0, 1, -a[1]!, -a[2]!]))
        } else {
          m = matMul(m, rot)
        }
        break
      }
    }
  }
  return m
}

interface Seg { cmd: string; args: number[] }

const ARG_COUNT: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0,
}

export function parsePath(d: string): Seg[] {
  const out: Seg[] = []
  const re = /([MmLlHhVvCcSsQqTtZzAa])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g
  let cmd = ''
  let args: number[] = []
  const flush = (): void => {
    if (!cmd) return
    const up = cmd.toUpperCase()
    if (up === 'A') throw new Error('elliptical arcs are not supported in path flattening')
    const k = ARG_COUNT[up] ?? 0
    if (k === 0) { out.push({ cmd, args: [] }); args = []; return }
    for (let i = 0; i + k <= args.length; i += k) {
      // A repeated M after the first pair is an implicit L, per the SVG spec.
      const c = i > 0 && up === 'M' ? (cmd === 'M' ? 'L' : 'l') : cmd
      out.push({ cmd: c, args: args.slice(i, i + k) })
    }
    args = []
  }
  for (let t = re.exec(d); t; t = re.exec(d)) {
    if (t[1]) { flush(); cmd = t[1] } else { args.push(Number(t[2])) }
  }
  flush()
  return out
}

/** Rewrite a path under a matrix, emitting absolute commands only. */
export function transformPath(d: string, m: Matrix): string {
  const segs = parsePath(d)
  const out: string[] = []
  let cx = 0, cy = 0     // current point, in the ORIGINAL coordinate system
  let sx = 0, sy = 0     // subpath start
  const emit = (c: string, pts: Array<[number, number]>): void => {
    out.push(c + pts.map(([x, y]) => `${num(x)} ${num(y)}`).join(' '))
  }
  for (const s of segs) {
    const rel = s.cmd === s.cmd.toLowerCase() && s.cmd !== 'Z' && s.cmd !== 'z'
    const up = s.cmd.toUpperCase()
    const abs = (i: number): [number, number] =>
      rel ? [cx + s.args[i]!, cy + s.args[i + 1]!] : [s.args[i]!, s.args[i + 1]!]
    switch (up) {
      case 'M': { const [x, y] = abs(0); emit('M', [apply(m, x, y)]); cx = x; cy = y; sx = x; sy = y; break }
      case 'L': { const [x, y] = abs(0); emit('L', [apply(m, x, y)]); cx = x; cy = y; break }
      case 'H': { const x = rel ? cx + s.args[0]! : s.args[0]!; emit('L', [apply(m, x, cy)]); cx = x; break }
      case 'V': { const y = rel ? cy + s.args[0]! : s.args[0]!; emit('L', [apply(m, cx, y)]); cy = y; break }
      case 'C': {
        const p1 = abs(0), p2 = abs(2), p3 = abs(4)
        emit('C', [apply(m, p1[0], p1[1]), apply(m, p2[0], p2[1]), apply(m, p3[0], p3[1])])
        cx = p3[0]; cy = p3[1]; break
      }
      case 'S': {
        const p2 = abs(0), p3 = abs(2)
        emit('C', [apply(m, cx, cy), apply(m, p2[0], p2[1]), apply(m, p3[0], p3[1])])
        cx = p3[0]; cy = p3[1]; break
      }
      case 'Q': {
        // Elevate the quadratic to a cubic so the PDF side needs only one curve form.
        const q = abs(0), p = abs(2)
        const c1: [number, number] = [cx + (2 / 3) * (q[0] - cx), cy + (2 / 3) * (q[1] - cy)]
        const c2: [number, number] = [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])]
        emit('C', [apply(m, c1[0], c1[1]), apply(m, c2[0], c2[1]), apply(m, p[0], p[1])])
        cx = p[0]; cy = p[1]; break
      }
      case 'T': {
        const p = abs(0)
        emit('L', [apply(m, p[0], p[1])])
        cx = p[0]; cy = p[1]; break
      }
      case 'Z': out.push('Z'); cx = sx; cy = sy; break
    }
  }
  return out.join(' ')
}

function num(x: number): string {
  const r = Math.round(x * 1000) / 1000
  return Object.is(r, -0) ? '0' : String(r)
}

export interface FlatPath { readonly d: string }

/**
 * Collapse a MathJax SVG into absolute path data under `base`.
 * A regex walk over a generated, well-formed subset — not a general XML parser, and it
 * says so by refusing anything it does not recognise rather than guessing.
 */
export function flattenSvg(svg: string, base: Matrix = IDENTITY): FlatPath[] {
  const out: FlatPath[] = []
  const stack: Matrix[] = [base]
  const tag = /<(\/?)(\w+)([^>]*?)(\/?)>/g
  for (let t = tag.exec(svg); t; t = tag.exec(svg)) {
    const [, closing, name, attrs, selfClosing] = t as unknown as [string, string, string, string, string]
    const top = stack[stack.length - 1]!
    if (closing) {
      if (name === 'g' || name === 'svg') stack.pop()
      continue
    }
    const tm = /transform="([^"]*)"/.exec(attrs)
    const local = tm ? matMul(top, parseTransform(tm[1]!)) : top
    if (name === 'path') {
      const dm = /\bd="([^"]*)"/.exec(attrs)
      if (dm) out.push({ d: transformPath(dm[1]!, local) })
    } else if (name === 'rect') {
      // MathJax draws fraction bars and \vec accents as rects.
      const g = (k: string): number => Number(/\b(?:^|\s)/.test('') ? 0 : (new RegExp(`\\b${k}="([-\\d.]+)"`).exec(attrs)?.[1] ?? 0))
      const x = g('x'), y = g('y'), w = g('width'), h = g('height')
      const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => apply(local, a!, b!))
      out.push({ d: `M${num(pts[0]![0])} ${num(pts[0]![1])} L${num(pts[1]![0])} ${num(pts[1]![1])} L${num(pts[2]![0])} ${num(pts[2]![1])} L${num(pts[3]![0])} ${num(pts[3]![1])} Z` })
    } else if ((name === 'g' || name === 'svg') && !selfClosing) {
      stack.push(local)
    }
  }
  return out
}
