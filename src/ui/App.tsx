import type { JSX } from 'react'
import { useEffect } from 'react'
import { Viewport } from './Viewport.js'
import {
  CommandPalette, Inspector, Outliner, Palette, SourcePanel, StatusStrip, exportFile, saveProject,
} from './Panels.js'
import { useStore } from './store.js'
import { deleteObject } from './model.js'
import { Axis } from './view.js'

export function App(): JSX.Element {
  const showSource = useStore((s) => s.showSource)
  const theme = useStore((s) => s.theme)
  const set = useStore((s) => s.set)

  // The page never changes colour on its own: the theme is what the store says, and the
  // store starts white. A diagram tool that follows the system clock is not a tool.
  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])

  // Every action has a shortcut, and every shortcut is an entry in the operation
  // registry -- the command palette lists the same set (src/ui/model.ts).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const typing = (e.target as HTMLElement | null)?.tagName
      const inField = typing === 'INPUT' || typing === 'TEXTAREA'
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); set('paletteOpen', true); return }
      if (mod && e.key === '`') { e.preventDefault(); set('showSource', !useStore.getState().showSource); return }
      if (mod && e.key.toLowerCase() === 's' && e.shiftKey) { e.preventDefault(); exportFile('svg'); return }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(); return }
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); useStore.getState().undo(); return }
      if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault(); useStore.getState().redo(); return
      }
      if (inField) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const sel = useStore.getState().selection[0]
        if (sel) { e.preventDefault(); useStore.getState().run(deleteObject, { name: sel }) }
      }
      if (e.key === 'Escape') useStore.getState().select(null)
      if (e.key === 'g') set('showGrid', !useStore.getState().showGrid)
      if (e.key === 'a') set('showAxes', !useStore.getState().showAxes)
      if (e.key === 'l') set('showLabels', !useStore.getState().showLabels)
      if (e.key === '2') set('mode', '2d')
      if (e.key === '3') set('mode', '3d')
      if (e.key === 'b') set('theme', useStore.getState().theme === 'light' ? 'dark' : 'light')
      // Shift+X/Y/Z looks down that axis; press again for the other side.
      if (e.shiftKey && 'XYZ'.includes(e.key.toUpperCase()) && /^[a-zA-Z]$/.test(e.key)) {
        const letter = e.key.toLowerCase()
        const current = useStore.getState().viewAxis
        const next = (current === `-${letter}` ? `+${letter}` : `-${letter}`) as Axis
        set('viewAxis', next)
        set('mode', '2d')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [set])

  return (
    <div className={`app${showSource ? ' with-source' : ''}`}>
      <Palette />
      <main className="stage">
        <Viewport />
        {showSource && <SourcePanel />}
      </main>
      <div className="right">
        <Outliner />
        <Inspector />
      </div>
      <StatusStrip />
      <CommandPalette />
    </div>
  )
}
