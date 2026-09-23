import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { read } from '../src/core/dsl.js'
import { withLocal } from '../src/core/library.js'
import { readLibraryDir } from '../src/io/files.js'
import { Scene, build } from '../src/core/scene.js'

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let cached: ReturnType<typeof readLibraryDir> | undefined
export function stdLibrary() {
  cached ??= readLibraryDir(join(ROOT, 'library'))
  return cached
}

export function example(name: string): string {
  return readFileSync(join(ROOT, 'examples', name), 'utf8')
}

export function buildSource(source: string): Scene {
  const doc = read(source)
  return build(doc, withLocal(stdLibrary(), doc.components))
}

export function buildExample(name: string): Scene {
  return buildSource(example(name))
}
