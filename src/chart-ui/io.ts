import { ChartDoc, normalize } from '../chart/model.js'
import { toFigure } from '../chart/render.js'
import { toSvg } from '../figure/svg.js'
import { toTikz } from '../figure/tikz.js'
import { toPdf } from '../figure/pdf.js'

const safe = (s: string): string => s.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'chart'

function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export type ExportKind = 'png' | 'svg' | 'pdf' | 'tex' | 'json'

export async function exportChart(doc: ChartDoc, kind: ExportKind): Promise<void> {
  const name = safe(doc.title)
  if (kind === 'json') {
    download(`${name}.chart.json`, JSON.stringify(doc, null, 1), 'application/json')
    return
  }
  const fig = toFigure(doc.objects, doc.title)
  if (kind === 'svg') download(`${name}.svg`, toSvg(fig, { background: doc.background }), 'image/svg+xml')
  else if (kind === 'tex') download(`${name}.tex`, toTikz(fig, { standalone: true }), 'text/plain')
  else if (kind === 'pdf') download(`${name}.pdf`, (await toPdf(fig, { background: doc.background, title: doc.title })) as BlobPart, 'application/pdf')
  else if (kind === 'png') download(`${name}.png`, await toPng(toSvg(fig, { background: doc.background }), fig.width, fig.height), 'image/png')
}

/** Rasterise the export SVG at 4x (about 300 dpi), in the browser, at the moment of export. */
async function toPng(svg: string, w: number, h: number): Promise<Blob> {
  const scale = 4
  const img = new Image()
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  try {
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('image')); img.src = url })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(w * scale)
    canvas.height = Math.ceil(h * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('png'))), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function openChartFile(): Promise<ChartDoc | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) { resolve(null); return }
      try { resolve(normalize(JSON.parse(await f.text()))) } catch (e) { reject(e) }
    }
    input.click()
  })
}
