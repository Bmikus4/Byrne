// PNG encoding without a canvas, so a computed field can be exported headless and the
// chart model keeps the no-DOM rule (test/import-graph.test.ts).

import { zlibSync } from 'fflate'

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** An 8-bit RGBA PNG from row-major pixels. */
export function encodePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13)
  const v = new DataView(ihdr.buffer)
  v.setUint32(0, w)
  v.setUint32(4, h)
  ihdr.set([8, 6, 0, 0, 0], 8)
  // Filter type 1 (Sub) on every row: the fields are smooth, so horizontal differences
  // are small and deflate halves the file against unfiltered rows.
  const raw = new Uint8Array(h * (1 + 4 * w))
  for (let y = 0; y < h; y++) {
    const o = y * (1 + 4 * w), s = y * 4 * w
    raw[o] = 1
    for (let i = 0; i < 4 * w; i++) raw[o + 1 + i] = (rgba[s + i]! - (i >= 4 ? rgba[s + i - 4]! : 0)) & 0xff
  }
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0
    s += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!
    s += i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)]! : '='
    s += i + 2 < bytes.length ? B64[c & 63]! : '='
  }
  return s
}

export const pngDataUrl = (w: number, h: number, rgba: Uint8Array): string =>
  `data:image/png;base64,${base64(encodePng(w, h, rgba))}`

/** The bytes of a base64 data: URL, for writing a picture out as its own file. */
export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(',') + 1)
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '')
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let n = 0
  for (let i = 0; i + 1 < clean.length; i += 4) {
    const q = [0, 1, 2, 3].map((k) => (i + k < clean.length ? B64.indexOf(clean[i + k]!) : 0))
    out[n++] = (q[0]! << 2) | (q[1]! >> 4)
    if (i + 2 < clean.length) out[n++] = ((q[1]! & 15) << 4) | (q[2]! >> 2)
    if (i + 3 < clean.length) out[n++] = ((q[2]! & 3) << 6) | q[3]!
  }
  return out.subarray(0, n)
}
