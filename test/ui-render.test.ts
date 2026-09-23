// @vitest-environment happy-dom
//
// A render test for the interface.
//
// This does NOT replace the manual procedures in docs/MANUAL-ACCEPTANCE.md -- nothing
// here can see anything. What it does is narrower and worth having: it mounts the whole
// component tree in a DOM against real solved scenes, drives the same events the user
// drives, and fails if a panel throws, a formatter blows up on a quantity, a hook is
// misused, or the tree stops reflecting the model. Those are the failures that would
// otherwise present as a blank page.
//
// The 3D viewport is stubbed. Its three.js setup needs a GPU and is explicitly out of
// scope here; docs/MANUAL-ACCEPTANCE.md records it as unobserved rather than pretending
// otherwise.
//
// A first attempt used server rendering. That was worthless and it is worth saying why:
// zustand's `useStore` passes `getInitialState` as the server snapshot, so every selector
// returned the state the module was born with and no test could change a thing. The
// assertions passed because the initial scene happened to satisfy them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { createRoot, Root } from 'react-dom/client'
import { act } from 'react'

vi.mock('../src/ui/Viewport.js', () => ({ Viewport: () => null }))

const { App } = await import('../src/ui/App.js')
const { EXAMPLES, useStore } = await import('../src/ui/store.js')
const { setParameter } = await import('../src/ui/model.js')

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = (): void => { act(() => { root.render(createElement(App)) }) }
const html = (): string => host.innerHTML
const text = (): string => host.textContent ?? ''

const load = (fragment: string): void => {
  const key = Object.keys(EXAMPLES).find((k) => k.includes(fragment))!
  act(() => { useStore.getState().setSource(EXAMPLES[key]!, false) })
}

describe('the interface renders and follows the model', () => {
  it('shows every surface the design requires', () => {
    load('A-inclined')
    mount()
    expect(text()).toContain('Outliner')
    expect(text()).toContain('Inspector')
    expect(html()).toContain('Search components')
    // The four modes, always visible, plus the DOF readout.
    for (const mode of ['units', 'frame', 'plane', 'snap']) expect(text()).toContain(mode)
    expect(text()).toMatch(/0 DOF/)
    expect(text()).toContain('well-constrained')
  })

  it('lists shipped and authored components together, by category', () => {
    load('A-inclined')
    mount()
    expect(text()).toContain('Mechanics')
    expect(text()).toContain('Fields')
    expect(text()).toContain('Spring')
    expect(text()).toContain('Point charge')
  })

  it('shows solved values in the outliner, carrying units', () => {
    load('A-inclined')
    mount()
    expect(text()).toContain('F_along')
    expect(text()).toMatch(/4\.711/)            // the down-slope resultant
    expect(text()).toMatch(/4\.711\s*N/)        // with its unit
  })

  it('opens the inspector on every kind of object without throwing', () => {
    load('A-inclined')
    mount()
    for (const name of ['theta', 'ramp', 'block', 'net', 'bal', 'W', 'N', 'f']) {
      act(() => useStore.getState().select(name))
      expect(text(), name).toContain(name)
    }
  })

  it('reflects an edit made through an operation', () => {
    load('A-inclined')
    mount()
    act(() => useStore.getState().select('F_along'))
    expect(text()).toMatch(/4\.711/)
    act(() => useStore.getState().run(setParameter, { name: 'theta', expr: '60 deg' }))
    expect(text()).toMatch(/14\.04/)            // m g (sin 60 - mu cos 60)
    act(() => useStore.getState().undo())
    expect(text()).toMatch(/4\.711/)
  })

  it('types into a numeric field and the model follows', () => {
    load('A-inclined')
    mount()
    act(() => useStore.getState().select('m'))
    const input = host.querySelector<HTMLInputElement>('.nf-input')!
    expect(input.value).toBe('2 kg')
    act(() => {
      nativeSetValue(input, '5 kg')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('focusout', { bubbles: true }))
    })
    const scene = useStore.getState().built.scene!
    expect(scene.names.get('m')!.t.length).toBe(1)
    expect(scene.values[scene.names.get('m')!.t[0]!]).toBeCloseTo(5, 12)
  })

  it('rejects a dimensionless value on a length field, on the field', () => {
    load('A-inclined')
    mount()
    act(() => useStore.getState().select('L'))
    const input = host.querySelector<HTMLInputElement>('.nf-input')!
    act(() => {
      nativeSetValue(input, '5')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(text()).toContain('needs a unit')
    act(() => {
      input.dispatchEvent(new Event('focusout', { bubbles: true }))
    })
    expect(useStore.getState().built.error).toMatch(/declared `length`/)
    expect(text()).toMatch(/declared `length`/)
  })

  it('reports a solver conflict in the strip and names the constraints', () => {
    act(() => {
      useStore.getState().setSource(`
project "byrne" version=1 { units length="m" force="N" }
param "a" "?" type="length" init="0 m"
constraint "c1" "residual" "a - 1 m" value="1e-12 m"
constraint "c2" "residual" "a - 2 m" value="1e-12 m"
`, false)
    })
    mount()
    expect(text()).toContain('over-constrained')
    const conflicts = useStore.getState().built.scene!.report.conflicts
    expect(conflicts[0]!.conflicting).toBe(true)
    expect(conflicts[0]!.constraints.sort()).toEqual(['c1', 'c2'])
  })

  it('keeps working when the document does not build, and names the error', () => {
    act(() => useStore.getState().setSource('param "a" "1 m"\nparam "b" "a + 1 s"', false))
    mount()
    expect(text()).toMatch(/dimension mismatch/)
    load('A-inclined')
    expect(text()).toContain('well-constrained')
  })

  it('mounts every bundled example', () => {
    mount()
    for (const key of Object.keys(EXAMPLES)) {
      act(() => useStore.getState().setSource(EXAMPLES[key]!, false))
      expect(useStore.getState().built.scene, key).not.toBeNull()
      expect(host.querySelector('.outliner'), key).not.toBeNull()
    }
  })

  it('opens the command palette on Ctrl-K and lists the operation registry', () => {
    load('A-inclined')
    mount()
    expect(host.querySelector('.cmdk')).toBeNull()
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
    })
    expect(host.querySelector('.cmdk')).not.toBeNull()
    expect(text()).toContain('Set parameter')
    expect(text()).toContain('Place component')
    expect(text()).toContain('Extract component from selection')
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
  })

  it('shows the source panel, and it is the file rather than a view of it', () => {
    load('A-inclined')
    mount()
    act(() => useStore.getState().set('showSource', true))
    const area = host.querySelector<HTMLTextAreaElement>('.source textarea')!
    expect(area.value).toContain('instance "ramp" "std/mechanics/inclined-plane"')
    act(() => useStore.getState().set('showSource', false))
  })

  it('marks an overridden instance field and reverts it', () => {
    load('C-spring')
    mount()
    act(() => useStore.getState().select('s2'))
    expect(host.querySelector('.nf-override')).not.toBeNull()
    act(() => { host.querySelector<HTMLElement>('.nf-override')!.click() })
    const scene = useStore.getState().built.scene!
    expect(scene.values[scene.names.get('s2.k')!.t[0]!]).toBeCloseTo(100, 10)
  })
})

/** Set an input's value the way React's synthetic events expect to observe it. */
function nativeSetValue(el: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
}
