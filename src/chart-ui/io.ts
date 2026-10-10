import { ChartDoc, ObjOf, normalize } from '../chart/model.js'
import { toFigure } from '../chart/render.js'
import { toSvg } from '../figure/svg.js'
import { tikzImages, toTikz } from '../figure/tikz.js'
import { toAnimatedSvg } from '../chart/animate.js'
import { dataUrlBytes } from '../chart/png.js'
import { strToU8, zipSync } from 'fflate'
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

/**
 * A heatmap's state record as text: a header that regenerates it, then one row per frame.
 * The header is the point: the rows are a function of those numbers and nothing else.
 */
export function stateRecordText(o: ObjOf<'field'>, rows: readonly string[]): string {
  return [
    `# Heatmap state record: ${rows.length} frames x ${rows[0]?.length ?? 0} sites = ${rows.length * (rows[0]?.length ?? 0)} bits.`,
    '# One row per frame, top to bottom, over one loop of the flow; frame ' + rows.length + ' is frame 0 again.',
    `# ratio=${o.ratio} pockets=${o.pockets} strength=${o.strength} twist=${o.twist} seed=${o.seed} poles=${o.poles} ` +
      `slice=${o.sliceAngle} sites=${o.sites} flow=${o.flow === 'out' ? 'out' : 'in'}`,
    ...rows,
    '',
  ].join('\n')
}

export function downloadText(name: string, text: string): void {
  download(name, text, 'text/plain')
}

export type ExportKind = 'png' | 'svg' | 'animated' | 'pdf' | 'tex' | 'json'

export async function exportChart(doc: ChartDoc, kind: ExportKind): Promise<void> {
  const name = safe(doc.title)
  if (kind === 'json') {
    download(`${name}.chart.json`, JSON.stringify(doc, null, 1), 'application/json')
    return
  }
  if (kind === 'animated') {
    download(`${name}-animated.svg`, toAnimatedSvg(doc), 'image/svg+xml')
    return
  }
  const fig = toFigure(doc.objects, doc.title)
  if (kind === 'tex' && tikzImages(fig).length) {
    // \includegraphics needs the pictures as files beside the .tex, so they travel together.
    const files: Record<string, Uint8Array> = { [`${name}.tex`]: strToU8(toTikz(fig, { standalone: true })) }
    for (const f of tikzImages(fig)) files[f.name] = dataUrlBytes(f.href)
    download(`${name}-latex.zip`, zipSync(files) as BlobPart, 'application/zip')
    return
  }
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
