// Re-render every acceptance figure from its example. The gate runs this, so a figure
// in the repository can never be out of date with the model that produced it.
import { execFileSync } from 'node:child_process'
import { readdirSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
mkdirSync(join(root, 'figures'), { recursive: true })

const examples = readdirSync(join(root, 'examples')).filter((f) => f.endsWith('.byrne'))
for (const f of examples) {
  const base = f.replace(/\.byrne$/, '')
  for (const ext of ['svg', 'tex']) {
    execFileSync('npx', ['tsx', 'src/cli/byrne.ts', 'render', `examples/${f}`, '-o', `figures/${base}.${ext}`], {
      cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    })
  }
}
console.log(`rendered ${examples.length} examples`)
