// Renders docs/DESIGN.md to dist/index.html.
//
// The page obeys the aesthetic rules the document itself sets out in §7.6: neutral
// canvas, three type sizes, monospace for numbers and code, one accent colour, no
// transition over 150 ms. If this page looks decorated, the document is not being
// taken at its word.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { marked } from 'marked'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const md = readFileSync(join(root, 'docs/DESIGN.md'), 'utf8')

const slug = (s) =>
  s.toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-')

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

const body = marked.parse(md)

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Byrne — Design</title>
<meta name="description" content="Design document for Byrne: a physics-diagram authoring environment with units, frames, a constraint solver, and publication-quality vector output.">
<style>
:root {
  --bg: #fbfbfa;
  --panel: #f2f2f0;
  --ink: #1b1b1a;
  --ink-soft: #6b6b66;
  --rule: #d9d9d4;
  --accent: #1f4fd8;      /* selection colour. one of them. */
  --warn: #b45309;
  --err: #b42318;
  --mono: ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace;
  --text: ui-serif, Charter, "Iowan Old Style", Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #131312; --panel: #1b1b1a; --ink: #e8e8e4; --ink-soft: #9a9a93;
    --rule: #2e2e2b; --accent: #7aa2ff; --warn: #d99a3a; --err: #e8756a;
  }
}
:root[data-theme="dark"] {
  --bg: #131312; --panel: #1b1b1a; --ink: #e8e8e4; --ink-soft: #9a9a93;
  --rule: #2e2e2b; --accent: #7aa2ff; --warn: #d99a3a; --err: #e8756a;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--bg); color: var(--ink);
  font-family: var(--text); font-size: 17px; line-height: 1.62;
}
.wrap { display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: 48px;
        max-width: 1180px; margin: 0 auto; padding: 0 16px; }
nav {
  position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto;
  padding: 40px 0 40px; border-right: 1px solid var(--rule);
  font-family: var(--mono); font-size: 12px; line-height: 1.55;
}
nav .brand { font-family: var(--text); font-size: 17px; letter-spacing: -0.01em;
             margin-bottom: 4px; }
nav .sub { color: var(--ink-soft); margin-bottom: 20px; }
nav a { display: block; color: var(--ink-soft); text-decoration: none;
        padding: 2px 10px 2px 0; transition: color 120ms ease; }
nav a:hover { color: var(--accent); }
main { padding: 40px 0 160px; min-width: 0; }
h1 { font-size: 30px; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 8px;
     font-weight: 600; }
h2 { font-size: 21px; margin: 56px 0 12px; padding-top: 18px; font-weight: 600;
     letter-spacing: -0.01em; border-top: 1px solid var(--rule); }
h3 { font-size: 17px; margin: 30px 0 8px; font-weight: 600; }
h4 { font-size: 17px; margin: 22px 0 6px; font-weight: 600; color: var(--ink-soft); }
p, li { font-size: 17px; }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
hr { border: 0; border-top: 1px solid var(--rule); margin: 40px 0; }
code { font-family: var(--mono); font-size: 13.5px; background: var(--panel);
       padding: 1px 5px; border-radius: 3px; }
pre { font-family: var(--mono); font-size: 12.5px; line-height: 1.5;
      background: var(--panel); border: 1px solid var(--rule); border-radius: 4px;
      padding: 14px 16px; overflow-x: auto; }
pre code { background: none; padding: 0; font-size: 12.5px; }
blockquote { margin: 0; padding-left: 16px; border-left: 2px solid var(--rule);
             color: var(--ink-soft); }
table { border-collapse: collapse; width: 100%; margin: 18px 0; display: block;
        overflow-x: auto; }
th, td { text-align: left; vertical-align: top; padding: 8px 12px 8px 0;
         border-bottom: 1px solid var(--rule); font-size: 14.5px; line-height: 1.5; }
th { font-family: var(--mono); font-size: 12px; font-weight: 500;
     text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-soft); }
td code { font-size: 12.5px; }
:target { scroll-margin-top: 24px; }
@media (max-width: 860px) {
  .wrap { grid-template-columns: 1fr; gap: 0; }
  nav { position: static; height: auto; border-right: 0;
        border-bottom: 1px solid var(--rule); padding: 28px 0 20px; }
  nav a { display: inline-block; padding-right: 14px; }
  main { padding-top: 28px; }
}
</style>
</head>
<body>
<div class="wrap">
<nav>
  <div class="brand">Byrne</div>
  <div class="sub">Phase 1 — design</div>
  ${toc.map((h) => `<a href="#${h.id}">${h.text}</a>`).join('\n  ')}
</nav>
<main>
${body}
</main>
</div>
</body>
</html>
`

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist/index.html'), html)
console.log(`dist/index.html  ${(html.length / 1024).toFixed(1)} KB  ${toc.length} sections`)
