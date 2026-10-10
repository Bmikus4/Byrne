// Pictures into the chart: from a file picker, a drop, or a paste.
//
// A picture is stored in the chart as a data: URL, so a saved .chart.json is the whole
// chart. Exports take only PNG and JPEG (pdf-lib embeds nothing else), so anything else
// (SVG, GIF, WebP) is drawn once onto a canvas here and kept as PNG.

import { Vec, make } from '../chart/model.js'
import { toWorld } from '../chart/render.js'
import { useChart } from './store.js'

/** Longest side kept. Larger photographs are scaled down: a chart is not a photo archive. */
const MAX_SIDE = 2000

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const img = new Image()
    img.onload = () => ok(img)
    img.onerror = () => fail(new Error('That file is not a picture this browser can read.'))
    img.src = src
  })
}

const asDataUrl = (f: Blob): Promise<string> => new Promise((ok, fail) => {
  const r = new FileReader()
  r.onload = () => ok(String(r.result))
  r.onerror = () => fail(r.error ?? new Error('read'))
  r.readAsDataURL(f)
})

export async function readPicture(file: Blob): Promise<{ src: string; px: [number, number] }> {
  const original = await asDataUrl(file)
  const img = await load(original)
  const w0 = img.naturalWidth || 1000, h0 = img.naturalHeight || 1000
  const jpeg = /jpe?g/i.test(file.type)
  const keep = (jpeg || /png/i.test(file.type)) && Math.max(w0, h0) <= MAX_SIDE
  if (keep) return { src: original, px: [w0, h0] }
  const k = Math.min(1, MAX_SIDE / Math.max(w0, h0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w0 * k))
  canvas.height = Math.max(1, Math.round(h0 * k))
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return { src: canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), px: [canvas.width, canvas.height] }
}

/** The world point at the middle of what the canvas shows. */
function viewCentre(): Vec {
  const s = useChart.getState()
  const el = document.querySelector('.chart-canvas')
  const r = el?.getBoundingClientRect()
  const w = r?.width ?? 800, h = r?.height ?? 600
  return toWorld([s.view.ox + w / 2 / s.view.zoom, s.view.oy + h / 2 / s.view.zoom])
}

export async function addPictures(files: readonly Blob[], at?: Vec): Promise<void> {
  const s = useChart.getState()
  const ids: string[] = []
  let p = at ?? viewCentre()
  for (const f of files) {
    if (!/^image\//.test(f.type)) continue
    try {
      const { src, px } = await readPicture(f)
      // Shown at its natural size at 96 dpi, kept between 2 and 12 cm wide.
      const w = Math.min(12, Math.max(2, px[0] / (96 / 2.54)))
      const name = (f as File).name?.replace(/\.[^.]+$/, '') || 'Picture'
      const o = make('image', p, { src, w, h: (w * px[1]) / px[0], name })
      s.add(o)
      ids.push(o.id)
      p = [p[0] + 0.6, p[1] - 0.6]
    } catch (e) {
      window.alert((e as Error).message)
    }
  }
  if (ids.length) { s.select(ids); s.setTool('select') }
}

export function pickPictures(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.multiple = true
  input.onchange = () => { void addPictures([...(input.files ?? [])]) }
  input.click()
}

/** Swap the picture inside an existing image object, keeping its width. */
export function replacePicture(id: string): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const f = input.files?.[0]
    if (!f) return
    const { src, px } = await readPicture(f)
    useChart.getState().update([id], (o) => (o.type === 'image' ? { ...o, src, h: (o.w * px[1]) / px[0] } : o), `${id}:src`)
  }
  input.click()
}

