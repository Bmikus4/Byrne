// The 3D viewport.
//
// The camera is ORTHOGRAPHIC, always, because the exporter is orthographic: that is what
// makes the figure you export the figure you were looking at. It opens in 2D -- camera
// locked down an axis, inputs constrained to the active construction plane -- because a
// 2D diagram is a 3D scene the user chose not to rotate, and most of them never will.
//
// The navigation cube in the corner is the only view control: click a face to look down
// that axis (which also sets the construction plane -- they are one fact, see view.ts),
// drag it to orbit into 3D.
//
// Nothing here is coplanar by accident. The grid, the axes and the active-plane border
// all sit in the same plane, so all three are drawn with depthWrite off in a fixed
// render order rather than fighting over the depth buffer, which is what produced the
// flickering doubled line along the grid.

import type { JSX } from 'react'
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Scene as ByrneScene, numberOf, vectorOf } from '../core/scene.js'
import { NAMED, dimEq } from '../core/dimension.js'
import { PALETTE } from '../figure/ir.js'
import { typeset } from '../figure/labels.js'
import { useStore } from './store.js'
import { instantiate } from './model.js'
import {
  Axis, BOX_FACE_ORDER, CLICK_SLOP, axisView, dragToOrbit, gridRotation,
  nearestAxis, planeNormal, snapInPlane,
} from './view.js'

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

const CUBE_PX = 92
const CUBE_MARGIN = 14
const TRANSITION_MS = 140

interface Kit {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  controls: OrbitControls
  content: THREE.Group
  guides: THREE.Group
  labels: HTMLDivElement[]
  cubeScene: THREE.Scene
  cubeCamera: THREE.OrthographicCamera
  cube: THREE.Group
  /** Camera transition, if one is running. */
  glide?: { from: THREE.Vector3; to: THREE.Vector3; upFrom: THREE.Vector3; upTo: THREE.Vector3; start: number }
  radius: number
}

export function Viewport(): JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const overlay = useRef<HTMLDivElement>(null)
  const readout = useRef<HTMLDivElement>(null)
  const cubeHost = useRef<HTMLDivElement>(null)
  const kit = useRef<Kit | undefined>(undefined)

  const built = useStore((s) => s.built)
  const selection = useStore((s) => s.selection)
  const showGrid = useStore((s) => s.showGrid)
  const showAxes = useStore((s) => s.showAxes)
  const showLabels = useStore((s) => s.showLabels)
  const activePlane = useStore((s) => s.activePlane)
  const viewAxis = useStore((s) => s.viewAxis)
  const mode = useStore((s) => s.mode)
  const theme = useStore((s) => s.theme)
  const snap = useStore((s) => s.snap)
  const gridStep = useStore((s) => s.gridStep)

  // --- one-time setup ------------------------------------------------------
  useEffect(() => {
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setScissorTest(false)
    el.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, -200, 200)
    camera.up.set(0, 0, 1)
    camera.position.set(0, -6, 0)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.14
    controls.enableRotate = false
    controls.screenSpacePanning = true
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE,
    }

    scene.add(new THREE.AmbientLight(0xffffff, 0.78))
    const key = new THREE.DirectionalLight(0xffffff, 0.8)
    key.position.set(2, -4, 6)
    scene.add(key)

    const guides = new THREE.Group()
    const content = new THREE.Group()
    scene.add(guides, content)

    const { cubeScene, cubeCamera, cube } = buildCube()

    kit.current = {
      renderer, scene, camera, controls, content, guides, labels: [],
      cubeScene, cubeCamera, cube, radius: 3,
    }

    const resize = (): void => {
      const w = el.clientWidth, h = el.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)          // updateStyle: the canvas must match its box
      fitFrustum(kit.current!, w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    const tick = (): void => {
      const k = kit.current!
      stepGlide(k)
      k.controls.update()
      const w = el.clientWidth, h = el.clientHeight

      k.renderer.setScissorTest(false)
      k.renderer.setViewport(0, 0, w, h)
      k.renderer.clear()
      k.renderer.render(k.scene, k.camera)

      // The cube, into a corner of the same canvas: one WebGL context, not two.
      k.cube.quaternion.copy(k.camera.quaternion).invert()
      k.renderer.setScissorTest(true)
      k.renderer.setViewport(w - CUBE_PX - CUBE_MARGIN, h - CUBE_PX - CUBE_MARGIN, CUBE_PX, CUBE_PX)
      k.renderer.setScissor(w - CUBE_PX - CUBE_MARGIN, h - CUBE_PX - CUBE_MARGIN, CUBE_PX, CUBE_PX)
      k.renderer.clearDepth()
      k.renderer.render(k.cubeScene, k.cubeCamera)
      k.renderer.setScissorTest(false)

      placeLabels()
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      disposeTree(scene)
      disposeTree(cubeScene)
      renderer.dispose()
      el.removeChild(renderer.domElement)
      kit.current = undefined
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- background follows the theme ---------------------------------------
  useEffect(() => {
    const k = kit.current
    if (!k || !host.current) return
    const css = getComputedStyle(host.current).getPropertyValue('--canvas').trim()
    k.scene.background = new THREE.Color(css || '#ffffff')
    k.cubeScene.background = null
  }, [theme])

  // --- camera follows the view axis and the mode ---------------------------
  useEffect(() => {
    const k = kit.current
    if (!k) return
    k.controls.enableRotate = mode === '3d'
    // In 2D the left button pans, because there is nothing to rotate and a drag that
    // silently tilted a locked view would make the mode a lie.
    k.controls.mouseButtons = mode === '3d'
      ? { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
      : { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
    if (mode === '2d') glideTo(k, viewAxis)
  }, [viewAxis, mode])

  // --- guides: grid, axes, active plane border -----------------------------
  useEffect(() => {
    const k = kit.current
    if (!k) return
    disposeTree(k.guides)
    k.guides.clear()

    const size = Math.max(4, Math.ceil(k.radius * 2.4))
    const divisions = Math.max(4, Math.min(120, Math.round(size / Math.max(0.05, gridStep))))
    const rot = gridRotation(activePlane)

    if (showGrid) {
      const line = new THREE.Color(theme === 'dark' ? 0x2f2f2b : 0xe2e2dc)
      const grid = new THREE.GridHelper(size, divisions, line, line)
      grid.rotation.set(rot[0], rot[1], rot[2])
      const gm = grid.material as THREE.Material
      gm.transparent = true
      gm.opacity = 0.9
      gm.depthWrite = false
      grid.renderOrder = -30
      k.guides.add(grid)

      // The active plane is shown by a border, not a translucent fill. A fill would be
      // coplanar with the grid and with any geometry lying on it, which is exactly the
      // depth fight that showed up as a doubled, flickering line.
      const half = size / 2
      const border = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-half, 0, -half), new THREE.Vector3(half, 0, -half),
          new THREE.Vector3(half, 0, half), new THREE.Vector3(-half, 0, half),
        ]),
        new THREE.LineBasicMaterial({
          color: 0x1f4fd8, transparent: true, opacity: 0.35, depthWrite: false,
        }),
      )
      border.rotation.set(rot[0], rot[1], rot[2])
      border.renderOrder = -29
      k.guides.add(border)
    }

    if (showAxes) {
      // Drawn after the grid, neither writing depth, so the coloured axis paints cleanly
      // over the grey centre line instead of z-fighting with it.
      const reach = size / 2
      for (const [dir, colour] of [
        [new THREE.Vector3(1, 0, 0), 0xc0392b],
        [new THREE.Vector3(0, 1, 0), 0x1e8449],
        [new THREE.Vector3(0, 0, 1), 0x1f4fd8],
      ] as const) {
        const axis = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([
            dir.clone().multiplyScalar(-reach), dir.clone().multiplyScalar(reach),
          ]),
          new THREE.LineBasicMaterial({
            color: colour, transparent: true, opacity: 0.5, depthWrite: false,
          }),
        )
        axis.renderOrder = -28
        k.guides.add(axis)
      }
    }
  }, [showGrid, showAxes, activePlane, gridStep, theme, built])

  // --- content -------------------------------------------------------------
  useEffect(() => {
    const k = kit.current
    if (!k || !built.scene) return
    disposeTree(k.content)
    k.content.clear()
    for (const d of k.labels) d.remove()
    k.labels = []

    drawScene(built.scene, k.content, selection)

    const box = new THREE.Box3().setFromObject(k.content)
    if (!box.isEmpty()) {
      const sphere = box.getBoundingSphere(new THREE.Sphere())
      k.radius = Math.max(0.5, sphere.radius)
      k.controls.target.copy(sphere.center)
    }
    const el = host.current
    if (el) fitFrustum(k, el.clientWidth, el.clientHeight)

    if (showLabels) k.labels = drawLabels(built.scene, overlay.current!)
  }, [built, selection, showLabels])

  function placeLabels(): void {
    const k = kit.current
    if (!k || !host.current) return
    const el = host.current
    for (const d of k.labels) {
      const p = (d as HTMLDivElement & { __world?: THREE.Vector3 }).__world
      if (!p) continue
      const v = p.clone().project(k.camera)
      d.style.transform = `translate(${((v.x + 1) / 2) * el.clientWidth}px, ${((1 - v.y) / 2) * el.clientHeight}px)`
      d.style.visibility = v.z > 1 || v.z < -1 ? 'hidden' : 'visible'
    }
  }

  // --- cursor readout and palette drops ------------------------------------
  const worldAt = (ev: { clientX: number; clientY: number }): THREE.Vector3 | null => {
    const k = kit.current
    if (!k || !host.current) return null
    const rect = host.current.getBoundingClientRect()
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    )
    const ray = new THREE.Raycaster()
    ray.setFromCamera(ndc, k.camera)
    const n = planeNormal(activePlane)
    const target = new THREE.Vector3()
    if (!ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(n[0], n[1], n[2]), 0), target)) return null
    if (snap === 'grid') {
      const s = snapInPlane([target.x, target.y, target.z], activePlane, gridStep)
      target.set(s[0], s[1], s[2])
    }
    return target
  }

  // --- the navigation cube -------------------------------------------------
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)

  const cubePointerDown = (ev: React.PointerEvent): void => {
    ev.preventDefault()
    drag.current = { x: ev.clientX, y: ev.clientY, moved: false }
    ;(ev.target as Element).setPointerCapture(ev.pointerId)
  }

  const cubePointerMove = (ev: React.PointerEvent): void => {
    const d = drag.current
    const k = kit.current
    if (!d || !k) return
    const dx = ev.clientX - d.x, dy = ev.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
    if (!d.moved) {
      d.moved = true
      useStore.getState().set('mode', '3d')
      k.controls.enableRotate = true
      k.glide = undefined
    }
    const { yaw, pitch } = dragToOrbit(ev.clientX - d.x, ev.clientY - d.y)
    d.x = ev.clientX; d.y = ev.clientY
    orbit(k, yaw, pitch)
  }

  const cubePointerUp = (ev: React.PointerEvent): void => {
    const d = drag.current
    const k = kit.current
    drag.current = null
    if (!d || !k) return
    if (d.moved) {
      // Snap back to the axis if the drag ended close to one; otherwise stay free.
      const dir = k.camera.position.clone().sub(k.controls.target).normalize()
      useStore.getState().set('viewAxis', nearestAxis([dir.x, dir.y, dir.z]))
      return
    }
    const axis = pickCubeFace(k, cubeHost.current!, ev.clientX, ev.clientY)
    if (!axis) return
    const st = useStore.getState()
    st.set('viewAxis', axis)
    st.set('activePlane', axisView(axis).plane)
    st.set('mode', '2d')
  }

  return (
    <div
      className="viewport"
      ref={host}
      onMouseMove={(ev) => {
        const p = worldAt(ev)
        if (readout.current) {
          readout.current.textContent = p
            ? `${fmt(p.x)}  ${fmt(p.y)}  ${fmt(p.z)}  m`
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
      <div
        className="navcube"
        ref={cubeHost}
        style={{ width: CUBE_PX, height: CUBE_PX, top: CUBE_MARGIN, right: CUBE_MARGIN }}
        title="click a face to look down that axis; drag to orbit"
        onPointerDown={cubePointerDown}
        onPointerMove={cubePointerMove}
        onPointerUp={cubePointerUp}
        onPointerCancel={() => { drag.current = null }}
      />
      <div className="viewbadge">
        <span className={mode === '2d' ? 'on' : ''}>{mode === '2d' ? `2D  ${viewAxis}` : '3D'}</span>
      </div>
      <div className="cursor-readout" ref={readout} />
      {built.error && <div className="viewport-error">{built.error}</div>}
    </div>
  )
}

const fmt = (x: number): string => (Math.abs(x) < 5e-4 ? '0.000' : x.toFixed(3))

// ---------------------------------------------------------------------------
// Camera

function fitFrustum(k: Kit, w: number, h: number): void {
  if (!w || !h) return
  const aspect = w / h
  const r = k.radius * 1.25
  k.camera.left = -r * aspect
  k.camera.right = r * aspect
  k.camera.top = r
  k.camera.bottom = -r
  k.camera.updateProjectionMatrix()
}

function glideTo(k: Kit, axis: Axis): void {
  const v = axisView(axis)
  const d = Math.max(4, k.radius * 4)
  const to = k.controls.target.clone().add(new THREE.Vector3(v.eye[0], v.eye[1], v.eye[2]).multiplyScalar(d))
  k.glide = {
    from: k.camera.position.clone(), to,
    upFrom: k.camera.up.clone(), upTo: new THREE.Vector3(v.up[0], v.up[1], v.up[2]),
    start: performance.now(),
  }
}

function stepGlide(k: Kit): void {
  const g = k.glide
  if (!g) return
  const t = Math.min(1, (performance.now() - g.start) / TRANSITION_MS)
  const e = t * t * (3 - 2 * t)
  k.camera.position.lerpVectors(g.from, g.to, e)
  k.camera.up.lerpVectors(g.upFrom, g.upTo, e).normalize()
  k.camera.lookAt(k.controls.target)
  if (t >= 1) k.glide = undefined
}

function orbit(k: Kit, yaw: number, pitch: number): void {
  const offset = k.camera.position.clone().sub(k.controls.target)
  const right = new THREE.Vector3().crossVectors(offset, k.camera.up).normalize()
  offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw)
  offset.applyAxisAngle(right, pitch)
  k.camera.position.copy(k.controls.target).add(offset)
  k.camera.up.set(0, 0, 1)
  k.camera.lookAt(k.controls.target)
}

// ---------------------------------------------------------------------------
// The cube

function faceTexture(label: string): THREE.Texture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = '#f2f2f0'
  g.fillRect(0, 0, size, size)
  g.strokeStyle = '#c9c9c2'
  g.lineWidth = 6
  g.strokeRect(3, 3, size - 6, size - 6)
  g.fillStyle = '#1b1b1a'
  g.font = '600 46px ui-monospace, Menlo, Consolas, monospace'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, size / 2, size / 2 + 2)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function buildCube(): { cubeScene: THREE.Scene; cubeCamera: THREE.OrthographicCamera; cube: THREE.Group } {
  const cubeScene = new THREE.Scene()
  const cubeCamera = new THREE.OrthographicCamera(-1.35, 1.35, 1.35, -1.35, 0.1, 20)
  cubeCamera.position.set(0, 0, 5)
  cubeCamera.lookAt(0, 0, 0)

  const cube = new THREE.Group()
  const materials = BOX_FACE_ORDER.map((axis) =>
    new THREE.MeshBasicMaterial({ map: faceTexture(axis.toUpperCase()) }))
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.35, 1.35), materials)
  box.name = 'cube'
  cube.add(box)
  cube.add(new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1.36, 1.36, 1.36)),
    new THREE.LineBasicMaterial({ color: 0x8c8c85 }),
  ))
  cubeScene.add(cube)
  return { cubeScene, cubeCamera, cube }
}

/** Which face of the cube is under the pointer, in the cube's own corner box. */
function pickCubeFace(k: Kit, el: HTMLElement, clientX: number, clientY: number): Axis | null {
  const rect = el.getBoundingClientRect()
  const ndc = new THREE.Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  )
  const ray = new THREE.Raycaster()
  ray.setFromCamera(ndc, k.cubeCamera)
  const box = k.cube.getObjectByName('cube')
  if (!box) return null
  const hit = ray.intersectObject(box, false)[0]
  if (!hit || hit.face === undefined || hit.face === null) return null
  // BoxGeometry groups run +x, -x, +y, -y, +z, -z, two triangles each.
  const index = Math.floor((hit.faceIndex ?? 0) / 2)
  return BOX_FACE_ORDER[index] ?? null
}

// ---------------------------------------------------------------------------
// Scene drawing

function v3(a: readonly number[]): THREE.Vector3 {
  return new THREE.Vector3(a[0], a[1], a[2])
}

/** Free every geometry and material under a node. Without this, every keystroke leaks. */
function disposeTree(root: THREE.Object3D): void {
  root.traverse((o: THREE.Object3D) => {
    const mesh = o as THREE.Mesh
    mesh.geometry?.dispose?.()
    const m = mesh.material as THREE.Material | THREE.Material[] | undefined
    if (Array.isArray(m)) m.forEach((x) => x.dispose())
    else m?.dispose?.()
  })
}

function drawScene(scene: ByrneScene, root: THREE.Group, selection: readonly string[]): void {
  const selected = new Set(selection)
  for (const g of scene.geometry) {
    const isSel = selected.has(g.owner) || selected.has(g.name)
    const color = isSel ? 0x1f4fd8 : col(g.style.stroke)
    const line = (pts: THREE.Vector3[]): void => {
      const obj = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color }),
      )
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
          if (pts.length < 3) break
          line([...pts, pts[0]!])
          const shape = new THREE.BufferGeometry().setFromPoints(pts)
          // Triangle fan, so a polygon with more than three corners is not silently
          // reduced to its first three.
          const index: number[] = []
          for (let i = 1; i + 1 < pts.length; i++) index.push(0, i, i + 1)
          shape.setIndex(index)
          shape.computeVertexNormals()
          const mesh = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.09, side: THREE.DoubleSide,
            depthWrite: false,
          }))
          mesh.renderOrder = -10
          mesh.name = g.name
          root.add(mesh)
          break
        }
        case 'sphere': {
          const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(N('radius'), 28, 18),
            new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02 }),
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
          const len = vec.length()
          if (len < 1e-9) break
          // The head must never be longer than the arrow, or a short vector renders as a
          // cone pointing the wrong way.
          const head = Math.min(0.11, len * 0.3)
          const arrow = new THREE.ArrowHelper(
            vec.clone().normalize(), at, len, color, head, head * 0.48,
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
            pts.push(c.clone().add(from.clone().applyAxisAngle(axis, (total * i) / 48).multiplyScalar(r)))
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
          const e2 = new THREE.Vector3().crossVectors(
            e1, Math.abs(e1.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0),
          ).normalize()
          const e3 = new THREE.Vector3().crossVectors(e1, e2)
          const steps = turns * 20
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
      // Geometry whose inputs did not solve is not drawn. The solver report already says
      // so, and a half-drawn shape would say it less clearly.
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

function labelAnchor(scene: ByrneScene, target: string): readonly number[] | undefined {
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
