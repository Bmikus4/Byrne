// Node-side file access. This is the only module in the project that reads a disk, and
// nothing in `core/` or `figure/` imports it. `test/import-graph.test.ts` enforces that.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { ComponentDef } from '../core/dsl.js'
import { loadLibrary } from '../core/library.js'

export function readLibraryDir(dir: string): Map<string, ComponentDef> {
  const sources: string[] = []
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry)
      if (statSync(p).isDirectory()) walk(p)
      else if (extname(p) === '.kdl') sources.push(readFileSync(p, 'utf8'))
    }
  }
  walk(dir)
  return loadLibrary(sources)
}

export const readText = (path: string): string => readFileSync(path, 'utf8')
