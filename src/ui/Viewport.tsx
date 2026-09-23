// The 3D viewport: at least 60% of the window, with a visible active construction plane,
// a discreet view indicator and a coordinate readout at the cursor.
//
// The viewport draws the SAME geometry the exporter projects -- both read scene.geometry.
// It cannot draw something the figure would not contain, which is the other half of "no
// screenshot masquerading as vector export".

import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Scene as ByrneScene, numberOf, vectorOf } from '../core/scene.js'
import { NAMED, dimEq } from '../core/dimension.js'
import { PALETTE } from '../figure/ir.js'
import { typeset } from '../figure/labels.js'
import { useStore } from './store.js'
import { instantiate } from './model.js'

const GLYPH_SCALE: Array<[keyof typeof NAMED, number]> = [
  ['force', 0.02], ['acceleration', 0.05], ['velocity', 0.1], ['efield', 1e-4],
]

function glyphScale(dim: readonly unknown[]): number {
  for (const [name, k] of GLYPH_SCALE) {
    const d = NAMED[name]
    if (d && dimEq(dim as never, d)) return k
  }
  return 0.1
}

const col = (name: string | undefined): number =>
  new THREE.Color(PALETTE[name ?? 'ink'] ?? PALETTE.ink!).getHex()

export function Viewport(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLDivElement>(null)
  const three = useRef<{
    renderer: THREE.WebGLRenderer
    scene: THREE.Scene
    camera: THREE.PerspectiveCamera
    controls: OrbitControls
    content: THREE.Group
    plane: THREE.Mesh
    labels: HTMLDivElement[]
  }>()

  const built = useStore((s) => s.built)
  const selection = useStore((s) => s.selection)
  const showGrid = useStore((s) => s.showGrid)
  const showAxes = useStore((s) => s.showAxes)
  const showLabels = useStore((s) => s.showLabels)
  const activePlane = useStore((s) => s.activePlane)
  const snap = useStore((s) => s.snap)
  const gridStep = useStore((s) => s.gridStep)

  // --- set up once ---------------------------------------------------------
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(getComputedStyle(el).getPropertyValue('--canvas').trim() || '#fbfbfa')

    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 500)
    camera.position.set(3.2, -4.6, 2.8)
    camera.up.set(0, 0, 1)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.target.set(0.8, 0, 0.5)

    scene.add(new THREE.AmbientLight(0xffffff, 0.75))
    const key = new THREE.DirectionalLight(0xffffff, 0.85)
    key.position.set(2, -4, 6)
    scene.add(key)

    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(8, 8),
      new THREE.MeshBasicMaterial({ color: 0x1f4fd8, transparent: true, opacity: 0.045, side: THREE.DoubleSide, depthWrite: false }),
    )
    scene.add(plane)

    const content = new THREE.Group()
    scene.add(content)

    three.current = { renderer, scene, camera, controls, content, plane, labels: [] }

    const resize = (): void => {
      const w = el.clientWidth, h = el.clientHeight
      renderer.setSize(w, h, false)
      camera.aspect = w / Math.max(1, h)
      camera.updateProjectionMatrix()
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    const tick = (): void => {
      controls.update()
      renderer.render(scene, camera)
      placeLabels()
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- the active construction plane ---------------------------------------
  useEffect(() => {
    const t = three.current
    if (!t) return
    t.plane.visible = showGrid
    t.plane.rotation.set(0, 0, 0)
    if (activePlane === 'zx') t.plane.rotation.x = Math.PI / 2
    else if (activePlane === 'yz') t.plane.rotation.y = Math.PI / 2
  }, [activePlane, showGrid])

  // --- rebuild the content on every model change ---------------------------
  useEffect(() => {
    const t = three.current
    if (!t || !built.scene) return
    t.content.clear()
    for (const d of t.labels) d.remove()
    t.labels = []

    if (showGrid) {
      const grid = new THREE.GridHelper(8, Math.round(8 / Math.max(0.05, gridStep)), 0xcfcfc8, 0xe6e6df)
      if (activePlane === 'zx') grid.rotation.x = Math.PI / 2
      else if (activePlane === 'yz') grid.rotation.z = Math.PI / 2
      ;(grid.material as THREE.Material).opacity = 0.5
      ;(grid.material as THREE.Material).transparent = true
      t.content.add(grid)
    }
    if (showAxes) t.content.add(new THREE.AxesHelper(0.6))

    drawScene(built.scene, t.content, selection)
    if (showLabels) t.labels = drawLabels(built.scene, overlay.current!)
  }, [built, selection, showGrid, showAxes, showLabels, activePlane, gridStep])

  function placeLabels(): void {
    const t = three.current
    if (!t || !overlay.current) return
    const el = host.current!
    for (const d of t.labels) {
      const p = (d as HTMLDivElement & { __world?: THREE.Vector3 }).__world
      if (!p) continue
      const v = p.clone().project(t.camera)
      const x = ((v.x + 1) / 2) * el.clientWidth
      const y = ((1 - v.y) / 2) * el.clientHeight
      d.style.transform = `translate(${x}px, ${y}px)`
      d.style.visibility = v.z > 1 ? 'hidden' : 'visible'
    }
  }

  // --- cursor readout and palette drops ------------------------------------
  const planeNormal = activePlane === 'xy' ? new THREE.Vector3(0, 0, 1)
    : activePlane === 'zx' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)

  const worldAt = (ev: React.MouseEvent | React.DragEvent): THREE.Vector3 | null => {
    const t = three.current
    if (!t) return null
    const rect = host.current!.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, t.camera)
    const target = new THREE.Vector3()
    const hit = ray.ray.intersectPlane(new THREE.Plane(planeNormal, 0), target)
    if (!hit) return null
    if (snap === 'grid') {
      target.set(
        Math.round(target.x / gridStep) * gridStep,
        Math.round(target.y / gridStep) * gridStep,
        Math.round(target.z / gridStep) * gridStep,
      )
    }
    return target
  }

  return (
    <div
      className="viewport"
      ref={host}
      onMouseMove={(ev) => {
        const p = worldAt(ev)
        if (readout.current) {
          readout.current.textContent = p
            ? `${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)} m`
            : ''
        }
      }}
      onDragOver={(ev) => { ev.preventDefault(); ev.dataTransfer.dropEffect = 'copy' }}
      onDrop={(ev) => {
        ev.preventDefault()
        const component = ev.dataTransfer.getData('application/x-byrne-component')
        if (!component) return
        const p = worldAt(ev) ?? new THREE.Vector3()
        useStore.getState().run(instantiate, {
          component,
          at: `vec(${p.x.toFixed(3)} m, ${p.y.toFixed(3)} m, ${p.z.toFixed(3)} m)`,
        })
      }}
    >
      <div className="overlay" ref={overlay} />
      <div className="view-indicator">
        {activePlane.toUpperCase()} plane &middot; perspective
      </div>
      <div className="cursor-readout" ref={readout} />
      {built.error && <div className="viewport-error">{built.error}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function v3(a: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(a[0], a[1], a[2])
}

function drawScene(scene: ByrneScene, root: THREE.Group, selection: readonly string[]): void {
  const selected = new Set(selection)
  for (const g of scene.geometry) {
    const isSel = selected.has(g.owner) || selected.has(g.name)
    const color = isSel ? 0x1f4fd8 : col(g.style.stroke)
    const line = (pts: THREE.Vector3[], width = 1): void => {
      const geom = new THREE.BufferGeometry().setFromPoints(pts)
      const obj = new THREE.Line(geom, new THREE.LineBasicMaterial({ color, linewidth: width }))
      obj.name = g.name
      root.add(obj)
    }
    const P = (key: string): THREE.Vector3 => v3(vectorOf(scene, g.props.get(key)!))
    const N = (key: string): number => numberOf(scene, g.props.get(key)!)
    try {
      switch (g.op) {
        case 'segment': line([P('from'), P('to')]); break
        case 'polygon': {
          const pts: THREE.Vector3[] = []
          for (let i = 0; g.props.has(`p${i}`); i++) pts.push(P(`p${i}`))
          line([...pts, pts[0]!])
          const shape = new THREE.BufferGeometry().setFromPoints(pts)
          shape.setIndex([0, 1, 2])
          shape.computeVertexNormals()
          const mesh = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.07, side: THREE.DoubleSide,
          }))
          mesh.name = g.name
          root.add(mesh)
          break
        }
        case 'sphere': {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(N('radius'), 24, 16),
            new THREE.MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.02 }),
          )
          mesh.position.copy(P('center'))
          mesh.name = g.name
          root.add(mesh)
          break
        }
        case 'marker': case 'anchor': {
          const p = P('at')
          const h = 0.05
          line([p.clone().add(new THREE.Vector3(-h, 0, -h)), p.clone().add(new THREE.Vector3(h, 0, h))])
          line([p.clone().add(new THREE.Vector3(-h, 0, h)), p.clone().add(new THREE.Vector3(h, 0, -h))])
          break
        }
        case 'arrow': {
          const at = P('at')
          const q = g.props.get('vector')!
          const vec = v3(vectorOf(scene, q)).multiplyScalar(glyphScale(q.dim))
          if (vec.length() < 1e-9) break
          const arrow = new THREE.ArrowHelper(
            vec.clone().normalize(), at, vec.length(), color,
            Math.min(0.12, vec.length() * 0.28), Math.min(0.06, vec.length() * 0.16),
          )
          arrow.name = g.name
          root.add(arrow)
          break
        }
        case 'arc': {
          const c = P('center')
          const from = P('from').normalize()
          const to = P('to').normalize()
          const r = N('radius')
          const axis = new THREE.Vector3().crossVectors(from, to).normalize()
          const total = Math.acos(Math.max(-1, Math.min(1, from.dot(to))))
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= 48; i++) {
            const d = from.clone().applyAxisAngle(axis, (total * i) / 48)
            pts.push(c.clone().add(d.multiplyScalar(r)))
          }
          line(pts)
          break
        }
        case 'helix': {
          const a = P('from'), b = P('to')
          const turns = Math.max(1, Math.round(N('turns')))
          const rad = N('radius')
          const axis = b.clone().sub(a)
          const len = axis.length()
          if (len < 1e-9) break
          const e1 = axis.clone().normalize()
          const e2 = new THREE.Vector3().crossVectors(e1, Math.abs(e1.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize()
          const e3 = new THREE.Vector3().crossVectors(e1, e2)
          const steps = turns * 16
          const pts: THREE.Vector3[] = []
          for (let i = 0; i <= steps; i++) {
            const t = i / steps
            const th = 2 * Math.PI * turns * t
            const rr = t < 0.1 || t > 0.9 ? 0 : rad
            pts.push(a.clone()
              .add(e1.clone().multiplyScalar(len * t))
              .add(e2.clone().multiplyScalar(rr * Math.cos(th)))
              .add(e3.clone().multiplyScalar(rr * Math.sin(th))))
          }
          line(pts)
          break
        }
        default: break
      }
    } catch {
      // A geometry item whose inputs did not solve is simply not drawn; the solver
      // report already says so, and a half-drawn shape would say it less clearly.
    }
  }
}

function drawLabels(scene: ByrneScene, overlay: HTMLDivElement): HTMLDivElement[] {
  const out: HTMLDivElement[] = []
  for (const l of scene.labels) {
    const anchor = labelAnchor(scene, l.target)
    if (!anchor) continue
    const div = document.createElement('div')
    div.className = 'label'
    const t = typeset(l.latex)
    div.innerHTML = t.fallback ? `<span class="label-fallback">${l.latex}</span>` : t.svg
    ;(div as HTMLDivElement & { __world?: THREE.Vector3 }).__world = v3(anchor)
    overlay.appendChild(div)
    out.push(div)
  }
  return out
}

function labelAnchor(scene: ByrneScene, target: string): number[] | undefined {
  const force = scene.names.get(`${target}.force`)
  const pos = scene.names.get(`${target}.position`)
  if (force && pos) {
    const f = vectorOf(scene, force)
    const p = vectorOf(scene, pos)
    const k = glyphScale(force.dim)
    return [p[0] + f[0] * k, p[1] + f[1] * k, p[2] + f[2] * k]
  }
  if (pos) return vectorOf(scene, pos)
  const direct = scene.names.get(target)
  if (direct && direct.t.length === 3) return vectorOf(scene, direct)
  const g = scene.geometry.find((it) => it.name.endsWith(`.${target}`))
  if (g) {
    for (const key of ['center', 'at', 'from', 'p0']) {
      const v = g.props.get(key)
      if (v && v.t.length === 3) return vectorOf(scene, v)
    }
  }
  return undefined
}
