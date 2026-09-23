// Builds the public site: a landing page, the design document, the exported figures,
// and a link into the application (which `vite build` writes to dist/app).
//
// The page obeys the aesthetic rules the design document sets out in §7.6 — neutral
// canvas, one accent, three type sizes, monospace for numbers. If it looks decorated,
// the document is not being taken at its word.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'dist')

const slug = (s) => s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

const toc = []
marked.use({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens)
      const id = slug(text.replace(/<[^>]+>/g, ''))
      if (depth === 2) toc.push({ id, text })
      return `<h${depth} id="${id}">${text}</h${depth}>\n`
    },
  },
})

const design = marked.parse(readFileSync(join(root, 'docs/DESIGN.md'), 'utf8'))
const primitives = marked.parse(readFileSync(join(root, 'docs/PRIMITIVES.md'), 'utf8'))

mkdirSync(join(out, 'figures'), { recursive: true })
const figures = []
const figDir = join(root, 'figures')
if (existsSync(figDir)) {
  for (const f of readdirSync(figDir)) {
    copyFileSync(join(figDir, f), join(out, 'figures', f))
    if (f.endsWith('.svg')) figures.push(f)
  }
}
figures.sort()

const FIGURE_CAPTIONS = {
  'A-inclined-plane.svg': 'A — mass on a ramp with friction. The normal force magnitude is solved, not typed in.',
  'B-three-force.svg': 'B — three-force equilibrium. Two tensions given; the third rope’s tension and angle are the unknowns.',
  'C-spring-chain.svg': 'C — spring-mass chain between two fixed ends. Both mass positions are solved.',
  'D-point-charge-flux.svg': 'D — point charge and a flux surface. The flux is a quadrature; Gauss’s law is the check.',
}

const feed = existsSync(join(root, 'public/data/feed.json'))
  ? JSON.parse(readFileSync(join(root, 'public/data/feed.json'), 'utf8'))
  : []
const latest = feed[feed.length - 1]

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Byrne</title>
<meta name="description" content="A physics-diagram authoring environment: direct-manipulation 3D construction, units and frames on every quantity, a constraint solver, and publication-quality vector output.">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M4 26 L22 26 L4 12 Z' fill='none' stroke='%231b1b1a' stroke-width='2'/%3E%3Ccircle cx='13' cy='19' r='3' fill='%235d6d7e'/%3E%3Cpath d='M13 19 L13 29' stroke='%23c0392b' stroke-width='2'/%3E%3C/svg%3E">
<style>
:root {
  --bg: #fbfbfa; --panel: #f2f2f0; --ink: #1b1b1a; --ink-soft: #6b6b66;
  --rule: #d9d9d4; --accent: #1f4fd8; --force: #c0392b; --field: #8e44ad;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace;
  --text: ui-serif, Charter, "Iowan Old Style", Georgia, serif;
  --ui: ui-sans-serif, system-ui, "Segoe UI", Inter, Helvetica, Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #131312; --panel: #1b1b1a; --ink: #e8e8e4; --ink-soft: #9a9a93;
    --rule: #2e2e2b; --accent: #7aa2ff; --force: #e8756a; --field: #b47fd8;
  }
}
:root[data-theme="dark"] {
  --bg: #131312; --panel: #1b1b1a; --ink: #e8e8e4; --ink-soft: #9a9a93;
  --rule: #2e2e2b; --accent: #7aa2ff; --force: #e8756a; --field: #b47fd8;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--text); font-size: 17px; line-height: 1.62; }
.wrap { display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 44px; max-width: 1180px; margin: 0 auto; padding: 0 16px; }
nav { position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; padding: 36px 0; border-right: 1px solid var(--rule); font-family: var(--mono); font-size: 12px; line-height: 1.55; }
nav .brand { font-family: var(--text); font-size: 18px; margin-bottom: 2px; }
nav .sub { color: var(--ink-soft); margin-bottom: 18px; }
nav a { display: block; color: var(--ink-soft); text-decoration: none; padding: 2px 10px 2px 0; transition: color 120ms ease; }
nav a:hover { color: var(--accent); }
nav .navgroup { color: var(--ink); margin: 16px 0 4px; }
main { padding: 36px 0 160px; min-width: 0; }
h1 { font-size: 34px; line-height: 1.12; letter-spacing: -0.022em; margin: 0 0 10px; font-weight: 600; }
.lede { font-size: 19px; color: var(--ink-soft); margin: 0 0 22px; max-width: 62ch; }
h2 { font-size: 21px; margin: 54px 0 12px; padding-top: 18px; font-weight: 600; letter-spacing: -0.01em; border-top: 1px solid var(--rule); }
h3 { font-size: 17px; margin: 28px 0 8px; font-weight: 600; }
h4 { font-size: 17px; margin: 20px 0 6px; font-weight: 600; color: var(--ink-soft); }
p, li { font-size: 17px; }
a { color: var(--accent); text-underline-offset: 2px; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 38px 0; }
code { font-family: var(--mono); font-size: 13.5px; background: var(--panel); padding: 1px 5px; border-radius: 3px; }
pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.5; background: var(--panel); border: 1px solid var(--rule); border-radius: 4px; padding: 14px 16px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote { margin: 0; padding-left: 16px; border-left: 2px solid var(--rule); color: var(--ink-soft); }
table { border-collapse: collapse; width: 100%; margin: 18px 0; display: block; overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px 8px 0; border-bottom: 1px solid var(--rule); font-size: 14.5px; line-height: 1.5; }
th { font-family: var(--mono); font-size: 12px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
:target { scroll-margin-top: 20px; }

.cta { display: flex; flex-wrap: wrap; gap: 10px; margin: 0 0 26px; }
.cta a { font-family: var(--ui); font-size: 14px; text-decoration: none; padding: 8px 14px; border: 1px solid var(--rule); border-radius: 4px; color: var(--ink); transition: border-color 120ms ease, color 120ms ease; }
.cta a:hover { border-color: var(--accent); color: var(--accent); }
.cta a.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
.cta a.primary:hover { color: #fff; opacity: 0.9; }

.status { font-family: var(--mono); font-size: 12px; color: var(--ink-soft); border: 1px solid var(--rule); border-radius: 4px; padding: 10px 12px; margin: 0 0 30px; }
.status b { color: var(--ink); font-weight: 500; }

.figs { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; margin: 20px 0 8px; }
.fig { border: 1px solid var(--rule); border-radius: 4px; overflow: hidden; background: #fff; }
.fig img { display: block; width: 100%; height: auto; }
.fig figcaption { font-family: var(--ui); font-size: 12.5px; color: var(--ink-soft); padding: 8px 10px; border-top: 1px solid var(--rule); background: var(--panel); }
figure { margin: 0; }

@media (max-width: 860px) {
  .wrap { grid-template-columns: 1fr; gap: 0; }
  nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--rule); padding: 26px 0 18px; }
  nav a { display: inline-block; padding-right: 14px; }
  main { padding-top: 26px; }
}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <div class="brand">Byrne</div>
  <div class="sub">physics diagrams</div>
  <a href="./app/">Open the application</a>
  <a href="#figures">Figures</a>
  <a href="https://github.com/Bmikus4/Byrne">Source</a>
  <div class="navgroup">Design document</div>
  ${toc.map((h) => `<a href="#${h.id}">${h.text}</a>`).join('\n  ')}
</nav>
<main>
<h1>Byrne</h1>
<p class="lede">A locally runnable physics-diagram authoring environment. Direct-manipulation 3D
construction, where every object is a typed physical quantity with units and a frame, the shipped
component library is written in the language the user gets, and the figure that comes out is vector
output generated from the model rather than captured from the screen.</p>

<div class="cta">
  <a class="primary" href="./app/">Open the application</a>
  <a href="#figures">See the exported figures</a>
  <a href="https://github.com/Bmikus4/Byrne">Source on GitHub</a>
</div>

<div class="status">
${latest ? `<b>${latest.headline}</b><br>${latest.tests} tests &middot; ticket ${latest.id} &middot; ${latest.at}` : '<b>Phase 2–4 built.</b> See the status matrix below.'}
</div>

<h2 id="figures">Figures</h2>
<p>Each of these is an SVG written by <code>byrne render</code> from the corresponding acceptance
example. No screenshot: the lines are the model&rsquo;s geometry projected analytically, and the
labels are MathJax glyph outlines from the same typesetting run the viewport uses.</p>
<div class="figs">
${figures.map((f) => `  <figure class="fig">
    <a href="./figures/${f}"><img src="./figures/${f}" alt="${FIGURE_CAPTIONS[f] ?? f}" loading="lazy"></a>
    <figcaption>${FIGURE_CAPTIONS[f] ?? f}</figcaption>
  </figure>`).join('\n')}
</div>

${design}

<h2 id="the-primitive-set">The primitive set</h2>
${primitives.replace(/^<h1[\s\S]*?<\/h1>/, '')}
</main>
</div>
</body>
</html>
`

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'index.html'), html)
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KB  ${toc.length} sections  ${figures.length} figures`)
