// A component library is a set of DSL sources. Nothing more.
//
// Importing a library never executes anything: a `.kdl` file is data, expressions are a
// total sublanguage with no I/O, and there is no scripting hook to call. That is why
// this module takes STRINGS and not paths — reading files is the caller's business, and
// `core/` does not touch a filesystem.

import { ComponentDef, read } from './dsl.js'

export class LibraryError extends Error {}

export function loadLibrary(sources: Iterable<string>): Map<string, ComponentDef> {
  const out = new Map<string, ComponentDef>()
  for (const src of sources) {
    const doc = read(src)
    if (doc.nodes.length) {
      throw new LibraryError(
        `a library file holds only component definitions; found a \`${doc.nodes[0]!.kind}\` node`,
      )
    }
    for (const c of doc.components) {
      const existing = out.get(c.path)
      if (existing && existing.version !== c.version) {
        throw new LibraryError(
          `component \`${c.path}\` is defined twice, at versions ${existing.version} and ${c.version}`,
        )
      }
      if (existing) throw new LibraryError(`component \`${c.path}\` is defined twice`)
      out.set(c.path, c)
    }
  }
  return out
}

/** Merge a project's own inline component definitions over a library. */
export function withLocal(
  base: ReadonlyMap<string, ComponentDef>,
  local: readonly ComponentDef[],
): Map<string, ComponentDef> {
  const out = new Map(base)
  for (const c of local) out.set(c.path, c)
  return out
}
