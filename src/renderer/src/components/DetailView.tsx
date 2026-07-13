import { useEffect, useRef, useState, useCallback } from 'react'
import type { Photo, LocalAdjustment } from '../types'
import styles from './DetailView.module.css'

interface ImageBounds {
  x: number
  y: number
  w: number
  h: number
}

interface Props {
  photo: Photo
  previewRevision: number
  localAdjs: LocalAdjustment[]
  selectedLocalId: number | null
  colorPickLocalId: number | null
  onSelectLocal: (id: number) => void
  onUpdateLocalPosition: (id: number, cx: number, cy: number, rx: number, ry: number) => void
  onUpdateLocalPoints: (id: number, points_json: string, refreshPreview?: boolean) => void
  onPickLocalColor: (id: number, r: number, g: number, b: number) => void
  onStopColorPick: () => void
}

type DragState =
  | { type: 'move'; id: number; startCx: number; startCy: number; startMx: number; startMy: number }
  | { type: 'resize-x'; id: number; startRx: number; startMx: number; sign: 1 | -1 }
  | { type: 'resize-y'; id: number; startRy: number; startMy: number; sign: 1 | -1 }
  | { type: 'lasso-point'; id: number; pointIndex: number; startPoints: Array<{ x: number; y: number }>; startMx: number; startMy: number }
  | null

type RenderQuality = 'fast' | 'full'
type ScaleMode = 'fit' | 'fill' | 'p100' | 'p200'

function parseLassoPoints(pointsJson: string | null): Array<{ x: number; y: number }> {
  if (!pointsJson) return []
  try {
    const parsed = JSON.parse(pointsJson) as Array<{ x: unknown; y: unknown }>
    return parsed
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  } catch {
    return []
  }
}

function pointToSegmentDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const abx = bx - ax
  const aby = by - ay
  const apx = px - ax
  const apy = py - ay
  const abLenSq = abx * abx + aby * aby
  if (abLenSq <= 1e-9) {
    const dx = px - ax
    const dy = py - ay
    return Math.sqrt(dx * dx + dy * dy)
  }
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLenSq))
  const cx = ax + t * abx
  const cy = ay + t * aby
  const dx = px - cx
  const dy = py - cy
  return Math.sqrt(dx * dx + dy * dy)
}

export function DetailView({ photo, previewRevision, localAdjs, selectedLocalId, colorPickLocalId, onSelectLocal, onUpdateLocalPosition, onUpdateLocalPoints, onPickLocalColor, onStopColorPick }: Props): React.JSX.Element {
  // src always holds the LAST successfully loaded image — never set to null
  const [src, setSrc] = useState<string | null>(photo.thumbnail)
  const [loading, setLoading] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [scaleMode, setScaleMode] = useState<ScaleMode>('fit')
  const [renderQuality, setRenderQuality] = useState<RenderQuality>('fast')
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const [showClipping, setShowClipping] = useState(false)
  const [requestedPreviewWidth, setRequestedPreviewWidth] = useState(1600)
  const clippingCanvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgBounds, setImgBounds] = useState<ImageBounds | null>(null)
  const [colorMaskPreview, setColorMaskPreview] = useState<string | null>(null)
  const [drawingLasso, setDrawingLasso] = useState<{ id: number; points: Array<{ x: number; y: number }> } | null>(null)
  const [draggingLasso, setDraggingLasso] = useState<{ id: number; points: Array<{ x: number; y: number }> } | null>(null)
  const dragRef = useRef<DragState>(null)
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null)
  const activePointerIdRef = useRef<number | null>(null)
  const pendingDragLassoRef = useRef<{ id: number; points: Array<{ x: number; y: number }> } | null>(null)
  const dragRafRef = useRef<number | null>(null)
  // Track the last photo id to reset src when switching photos
  const lastPhotoId = useRef<number | null>(null)

  const getScaleModeMultiplier = useCallback(() => {
    if (scaleMode === 'fit' || scaleMode === 'fill') return 1

    const img = imgRef.current
    if (!img || img.naturalWidth <= 0 || img.clientWidth <= 0) {
      return scaleMode === 'p200' ? 2 : 1
    }

    const oneToOne = img.naturalWidth / img.clientWidth
    return oneToOne * (scaleMode === 'p200' ? 2 : 1)
  }, [scaleMode])

  const updateRequestedPreviewWidth = useCallback(() => {
    const container = containerRef.current
    const viewportWidth = container?.clientWidth ?? 0
    const dpr = window.devicePixelRatio || 1
    const target = Math.round(Math.max(viewportWidth, 1200) * dpr * zoom * getScaleModeMultiplier())
    const clamped = Math.max(1600, Math.min(7680, target))

    setRequestedPreviewWidth((prev) => {
      // Ignore tiny oscillations from layout rounding to avoid useless re-renders.
      if (Math.abs(prev - clamped) < 64) return prev
      return clamped
    })
  }, [getScaleModeMultiplier, zoom])

  // Load preview — keep old src visible until new one arrives
  useEffect(() => {
    // Only reset to thumbnail when switching photos, not on edits refresh
    if (lastPhotoId.current !== photo.id) {
      lastPhotoId.current = photo.id
      setSrc(photo.thumbnail)
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      ;(async () => {
        const preview = await window.api.getPreview(photo.id, requestedPreviewWidth)
        if (cancelled) return
        if (preview) setSrc(preview)

        // Progressive loading path: fast preview first, then full resolution.
        if (renderQuality === 'full') {
          const fullRes = await window.api.getPreview(photo.id)
          if (cancelled) return
          if (fullRes) setSrc(fullRes)
        }

        setLoading(false)
      })()
    }, 140)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [photo.id, previewRevision, renderQuality, requestedPreviewWidth])

  useEffect(() => {
    if (!drawingLasso) return
    const selected = localAdjs.find((a) => a.id === selectedLocalId)
    if (!selected || selected.kind !== 'lasso' || selected.id !== drawingLasso.id) {
      setDrawingLasso(null)
    }
  }, [drawingLasso, localAdjs, selectedLocalId])

  useEffect(() => {
    if (!draggingLasso) return
    const selected = localAdjs.find((a) => a.id === selectedLocalId)
    if (!selected || selected.kind !== 'lasso' || selected.id !== draggingLasso.id) {
      setDraggingLasso(null)
    }
  }, [draggingLasso, localAdjs, selectedLocalId])

  const selectedColorAdj = localAdjs.find((a) => a.id === selectedLocalId && a.kind === 'color') ?? null

  useEffect(() => {
    const img = imgRef.current
    if (!img || !imgBounds || !selectedColorAdj || !src || loading) {
      setColorMaskPreview(null)
      return
    }

    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return

      const displayW = Math.max(1, Math.round(imgBounds.w))
      const displayH = Math.max(1, Math.round(imgBounds.h))
      const scale = Math.min(1, 640 / displayW)
      const w = Math.max(1, Math.round(displayW * scale))
      const h = Math.max(1, Math.round(displayH * scale))

      const sourceCanvas = document.createElement('canvas')
      sourceCanvas.width = w
      sourceCanvas.height = h
      const sourceCtx = sourceCanvas.getContext('2d')
      if (!sourceCtx) return
      sourceCtx.drawImage(img, 0, 0, w, h)
      const sourceData = sourceCtx.getImageData(0, 0, w, h)

      const outCanvas = document.createElement('canvas')
      outCanvas.width = w
      outCanvas.height = h
      const outCtx = outCanvas.getContext('2d')
      if (!outCtx) return
      const out = outCtx.createImageData(w, h)

      const tr = selectedColorAdj.target_r
      const tg = selectedColorAdj.target_g
      const tb = selectedColorAdj.target_b
      const tol = Math.max(1, Math.min(255, Math.round(selectedColorAdj.color_tolerance)))
      const tolSq = tol * tol

      for (let i = 0; i < w * h; i++) {
        const p = i * 4
        const dr = sourceData.data[p] - tr
        const dg = sourceData.data[p + 1] - tg
        const db = sourceData.data[p + 2] - tb
        const distSq = dr * dr + dg * dg + db * db
        const match = distSq <= tolSq
        const selected = selectedColorAdj.invert === 1 ? !match : match

        out.data[p] = 32
        out.data[p + 1] = 201
        out.data[p + 2] = 255
        out.data[p + 3] = selected ? 120 : 0
      }

      outCtx.putImageData(out, 0, 0)
      setColorMaskPreview(outCanvas.toDataURL('image/png'))
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [imgBounds, loading, selectedColorAdj, src])

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current)
      }
    }
  }, [])

  // Clipping overlay: red = highlights blown (any channel ≥ 250), blue = shadows crushed (all channels ≤ 5)
  useEffect(() => {
    const canvas = clippingCanvasRef.current
    const img = imgRef.current
    if (!canvas || !img || !showClipping) {
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx?.clearRect(0, 0, canvas.width, canvas.height)
      }
      return
    }

    if (img.naturalWidth <= 0 || img.naturalHeight <= 0) return

    let cancelled = false
    const raf = requestAnimationFrame(() => {
      if (cancelled) return
      const w = img.naturalWidth
      const h = img.naturalHeight

      const src = document.createElement('canvas')
      src.width = w
      src.height = h
      const sCtx = src.getContext('2d')
      if (!sCtx) return
      sCtx.drawImage(img, 0, 0, w, h)
      const { data } = sCtx.getImageData(0, 0, w, h)

      canvas.width = w
      canvas.height = h
      const dCtx = canvas.getContext('2d')
      if (!dCtx) return
      const out = dCtx.createImageData(w, h)

      const CLIP_HI = 250
      const CLIP_LO = 5

      for (let i = 0; i < w * h; i++) {
        const p = i * 4
        const r = data[p]
        const g = data[p + 1]
        const b = data[p + 2]
        const blown = r >= CLIP_HI || g >= CLIP_HI || b >= CLIP_HI
        const crushed = r <= CLIP_LO && g <= CLIP_LO && b <= CLIP_LO
        if (blown) {
          out.data[p] = 255; out.data[p + 1] = 0; out.data[p + 2] = 0; out.data[p + 3] = 200
        } else if (crushed) {
          out.data[p] = 0; out.data[p + 1] = 80; out.data[p + 2] = 255; out.data[p + 3] = 200
        } else {
          out.data[p + 3] = 0
        }
      }

      dCtx.putImageData(out, 0, 0)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
  }, [showClipping, src, loading])

  const scheduleDraggingLassoPreview = useCallback((next: { id: number; points: Array<{ x: number; y: number }> }) => {
    pendingDragLassoRef.current = next
    if (dragRafRef.current !== null) return
    dragRafRef.current = requestAnimationFrame(() => {
      dragRafRef.current = null
      if (!pendingDragLassoRef.current) return
      setDraggingLasso(pendingDragLassoRef.current)
    })
  }, [])

  // Compute actual image bounds within container (object-fit: contain)
  const updateBounds = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    const cr = container.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    setImgBounds({ x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height })
    updateRequestedPreviewWidth()
  }, [updateRequestedPreviewWidth])

  useEffect(() => {
    const ro = new ResizeObserver(updateBounds)
    if (containerRef.current) ro.observe(containerRef.current)
    if (imgRef.current) ro.observe(imgRef.current)
    updateBounds()
    return () => ro.disconnect()
  }, [src, updateBounds])

  useEffect(() => {
    updateBounds()
  }, [pan, scaleMode, updateBounds, zoom])

  useEffect(() => {
    updateRequestedPreviewWidth()
  }, [photo.id, updateRequestedPreviewWidth])

  const clampZoom = useCallback((value: number) => {
    // Allow zooming below 1 in fit/fill mode (further out than the default fit)
    const min = (scaleMode === 'p100' || scaleMode === 'p200') ? 1 : 0.1
    return Math.max(min, Math.min(8, value))
  }, [scaleMode])

  const applyZoomStep = useCallback((direction: 1 | -1) => {
    setZoom((prev) => {
      const step = prev <= 1 ? 0.1 : (prev < 2 ? 0.2 : 0.4)
      return clampZoom(prev + direction * step)
    })
  }, [clampZoom])

  const handleSetScaleMode = useCallback((next: ScaleMode) => {
    setScaleMode(next)
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  const handleZoomIn = useCallback(() => {
    applyZoomStep(1)
  }, [applyZoomStep])

  const handleZoomOut = useCallback(() => {
    // In p100/p200 mode at zoom=1, switch to fit instead of going below 1
    if (zoom <= 1.001 && (scaleMode === 'p100' || scaleMode === 'p200')) {
      handleSetScaleMode('fit')
      return
    }
    applyZoomStep(-1)
  }, [applyZoomStep, handleSetScaleMode, scaleMode, zoom])

  const handleResetZoom = useCallback(() => {
    if (scaleMode === 'p100' || scaleMode === 'p200') {
      handleSetScaleMode('fit')
      return
    }
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [handleSetScaleMode, scaleMode])

  const effectiveZoom = zoom * getScaleModeMultiplier()

  const clampPan = useCallback((x: number, y: number, zoomValue: number = effectiveZoom) => {
    const container = containerRef.current
    const img = imgRef.current
    if (!container || !img) return { x: 0, y: 0 }

    const cw = container.clientWidth
    const ch = container.clientHeight
    const scaledW = img.clientWidth * zoomValue
    const scaledH = img.clientHeight * zoomValue
    const maxX = Math.max(0, (scaledW - cw) / 2)
    const maxY = Math.max(0, (scaledH - ch) / 2)

    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    }
  }, [effectiveZoom])

  useEffect(() => {
    if (effectiveZoom <= 1.001) {
      setPan({ x: 0, y: 0 })
      setIsPanning(false)
      panRef.current = null
      return
    }
    setPan((prev) => clampPan(prev.x, prev.y))
  }, [clampPan, effectiveZoom, scaleMode, src])

  const handlePanPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    if (effectiveZoom <= 1.001) return
    if (colorPickLocalId !== null) return

    const target = e.target as HTMLElement
    if (target.closest(`.${styles.zoomControls}`)) return

    const tag = target.tagName.toLowerCase()
    if (tag === 'circle' || tag === 'ellipse' || tag === 'polygon' || tag === 'polyline' || tag === 'text') {
      return
    }

    if (drawingLasso || dragRef.current) return

    panRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    }
    setIsPanning(true)
    e.currentTarget.setPointerCapture(e.pointerId)
    e.preventDefault()
  }, [colorPickLocalId, drawingLasso, effectiveZoom, pan.x, pan.y])

  const handlePanPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = panRef.current
    if (!state || state.pointerId !== e.pointerId) return

    const dx = e.clientX - state.startX
    const dy = e.clientY - state.startY
    setPan(clampPan(state.startPanX + dx, state.startPanY + dy))
  }, [clampPan])

  const handlePanPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const state = panRef.current
    if (!state || state.pointerId !== e.pointerId) return
    panRef.current = null
    setIsPanning(false)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  const handleImageWrapWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (e.deltaY < 0) {
      applyZoomStep(1)
    } else if (e.deltaY > 0) {
      handleZoomOut()
    }
  }, [applyZoomStep, handleZoomOut])

  // Mouse events for drag/resize
  const handleSvgPointerMove = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    const drag = dragRef.current
    if (!drag || !imgBounds) return
    const svgRect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - svgRect.left
    const my = e.clientY - svgRect.top

    const adj = localAdjs.find(a => a.id === drag.id)
    if (!adj) return

    if (drag.type === 'move') {
      const dx = (mx - drag.startMx) / imgBounds.w
      const dy = (my - drag.startMy) / imgBounds.h
      const cx = Math.max(0, Math.min(1, drag.startCx + dx))
      const cy = Math.max(0, Math.min(1, drag.startCy + dy))
      onUpdateLocalPosition(drag.id, cx, cy, adj.rx, adj.ry)
    } else if (drag.type === 'resize-x') {
      const dx = (mx - drag.startMx) / imgBounds.w * drag.sign
      const rx = Math.max(0.02, drag.startRx + dx)
      onUpdateLocalPosition(drag.id, adj.cx, adj.cy, rx, adj.ry)
    } else if (drag.type === 'resize-y') {
      const dy = (my - drag.startMy) / imgBounds.h * drag.sign
      const ry = Math.max(0.02, drag.startRy + dy)
      onUpdateLocalPosition(drag.id, adj.cx, adj.cy, adj.rx, ry)
    } else if (drag.type === 'lasso-point') {
      const dx = (mx - drag.startMx) / imgBounds.w
      const dy = (my - drag.startMy) / imgBounds.h
      const next = drag.startPoints.map((p, idx) => {
        if (idx !== drag.pointIndex) return p
        return {
          x: Math.max(0, Math.min(1, p.x + dx)),
          y: Math.max(0, Math.min(1, p.y + dy)),
        }
      })
      scheduleDraggingLassoPreview({ id: drag.id, points: next })

    }
  }, [imgBounds, localAdjs, onUpdateLocalPosition, scheduleDraggingLassoPreview])

  const handleSvgPointerUp = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current)
      dragRafRef.current = null
    }
    const drag = dragRef.current
    const latest = pendingDragLassoRef.current ?? draggingLasso
    pendingDragLassoRef.current = null

    if (drag?.type === 'lasso-point' && latest && latest.id === drag.id) {
      onUpdateLocalPoints(drag.id, JSON.stringify(latest.points), true)
      setDraggingLasso(null)
    }
    activePointerIdRef.current = null
    dragRef.current = null
  }, [draggingLasso, onUpdateLocalPoints])

  const finalizeDrawing = useCallback((withExtraPoint?: { x: number; y: number }) => {
    if (!drawingLasso) return
    const points = withExtraPoint ? [...drawingLasso.points, withExtraPoint] : drawingLasso.points
    if (points.length >= 3) {
      onUpdateLocalPoints(drawingLasso.id, JSON.stringify(points))
    }
    setDrawingLasso(null)
  }, [drawingLasso, onUpdateLocalPoints])

  const normalizedPointFromEvent = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!imgBounds) return null
    const svgRect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - svgRect.left
    const py = e.clientY - svgRect.top
    if (px < imgBounds.x || px > imgBounds.x + imgBounds.w || py < imgBounds.y || py > imgBounds.y + imgBounds.h) {
      return null
    }
    return {
      x: Math.max(0, Math.min(1, (px - imgBounds.x) / imgBounds.w)),
      y: Math.max(0, Math.min(1, (py - imgBounds.y) / imgBounds.h)),
    }
  }, [imgBounds])

  const sampleColorFromEvent = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const img = imgRef.current
    if (!img || !imgBounds || img.naturalWidth <= 0 || img.naturalHeight <= 0) return null

    const svgRect = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - svgRect.left
    const py = e.clientY - svgRect.top
    if (px < imgBounds.x || px > imgBounds.x + imgBounds.w || py < imgBounds.y || py > imgBounds.y + imgBounds.h) {
      return null
    }

    const ix = Math.max(0, Math.min(img.naturalWidth - 1, Math.round(((px - imgBounds.x) / imgBounds.w) * (img.naturalWidth - 1))))
    const iy = Math.max(0, Math.min(img.naturalHeight - 1, Math.round(((py - imgBounds.y) / imgBounds.h) * (img.naturalHeight - 1))))

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight)
    const data = ctx.getImageData(ix, iy, 1, 1).data
    return { r: data[0], g: data[1], b: data[2] }
  }, [imgBounds])

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (colorPickLocalId !== null) {
      const selected = localAdjs.find((a) => a.id === colorPickLocalId)
      if (selected?.kind === 'color') {
        e.preventDefault()
        const sample = sampleColorFromEvent(e)
        if (sample) {
          onPickLocalColor(colorPickLocalId, sample.r, sample.g, sample.b)
          onStopColorPick()
        }
        return
      }
    }

    if (!drawingLasso || e.detail > 1) return
    if (dragRef.current) return
    const point = normalizedPointFromEvent(e)
    if (!point) return

    const first = drawingLasso.points[0]
    if (first && drawingLasso.points.length >= 3) {
      const dx = (point.x - first.x) * imgBounds!.w
      const dy = (point.y - first.y) * imgBounds!.h
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist <= 12) {
        finalizeDrawing()
        return
      }
    }

    setDrawingLasso((prev) => {
      if (!prev) return prev
      return { ...prev, points: [...prev.points, point] }
    })
  }, [colorPickLocalId, drawingLasso, finalizeDrawing, imgBounds, localAdjs, normalizedPointFromEvent, onPickLocalColor, onStopColorPick, sampleColorFromEvent])

  const handleSvgDoubleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawingLasso) return
    e.preventDefault()
    const point = normalizedPointFromEvent(e)
    finalizeDrawing(point ?? undefined)
  }, [drawingLasso, finalizeDrawing, normalizedPointFromEvent])

  const handleInsertLassoPoint = useCallback((e: React.MouseEvent<SVGPolygonElement>, adj: LocalAdjustment) => {
    if (!(e.altKey || e.metaKey || e.ctrlKey)) return
    e.preventDefault()
    e.stopPropagation()
    if (!imgBounds || adj.kind !== 'lasso') return

    const points = parseLassoPoints(adj.points_json)
    if (points.length < 3) return

    const svg = e.currentTarget.closest('svg')
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const clickY = e.clientY - rect.top

    const nx = Math.max(0, Math.min(1, (clickX - imgBounds.x) / imgBounds.w))
    const ny = Math.max(0, Math.min(1, (clickY - imgBounds.y) / imgBounds.h))

    const scaled = points.map((p) => ({ x: imgBounds.x + p.x * imgBounds.w, y: imgBounds.y + p.y * imgBounds.h }))
    let bestIdx = 0
    let bestDist = Number.POSITIVE_INFINITY
    for (let i = 0; i < scaled.length; i++) {
      const a = scaled[i]
      const b = scaled[(i + 1) % scaled.length]
      const dist = pointToSegmentDistance(clickX, clickY, a.x, a.y, b.x, b.y)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    }

    // Require modifier+click near contour to avoid accidental insertions.
    if (bestDist > 14) return

    const next = [...points]
    next.splice(bestIdx + 1, 0, { x: nx, y: ny })
    onUpdateLocalPoints(adj.id, JSON.stringify(next))
  }, [imgBounds, onUpdateLocalPoints])

  return (
    <div className={styles.container} onWheel={handleImageWrapWheel}>
      <div
        className={
          styles.imageWrap
          + (effectiveZoom > 1.001 ? ' ' + styles.pannable : '')
          + (isPanning ? ' ' + styles.panning : '')
        }
        ref={containerRef}
        onPointerDown={handlePanPointerDown}
        onPointerMove={handlePanPointerMove}
        onPointerUp={handlePanPointerUp}
        onPointerCancel={handlePanPointerUp}
      >
        <div className={styles.floatingControls}>
          <div className={styles.controlGroup}>
            <button type="button" className={styles.modeBtn + (scaleMode === 'fit' ? ' ' + styles.modeBtnActive : '')} onClick={() => handleSetScaleMode('fit')}>Fit</button>
            <button type="button" className={styles.modeBtn + (scaleMode === 'fill' ? ' ' + styles.modeBtnActive : '')} onClick={() => handleSetScaleMode('fill')}>Fill</button>
            <button type="button" className={styles.modeBtn + (scaleMode === 'p100' ? ' ' + styles.modeBtnActive : '')} onClick={() => handleSetScaleMode('p100')}>100%</button>
            <button type="button" className={styles.modeBtn + (scaleMode === 'p200' ? ' ' + styles.modeBtnActive : '')} onClick={() => handleSetScaleMode('p200')}>200%</button>
          </div>
          <div className={styles.controlGroup}>
            <button type="button" className={styles.modeBtn + (renderQuality === 'fast' ? ' ' + styles.modeBtnActive : '')} onClick={() => setRenderQuality('fast')}>Rapide</button>
            <button type="button" className={styles.modeBtn + (renderQuality === 'full' ? ' ' + styles.modeBtnActive : '')} onClick={() => setRenderQuality('full')}>Pleine</button>
          </div>
          <div className={styles.controlGroup}>
            <button
              type="button"
              className={styles.modeBtn + (showClipping ? ' ' + styles.clippingActive : '')}
              onClick={() => setShowClipping((v) => !v)}
              title="Afficher les zones écrêtées (rouge = hautes lumières, bleu = ombres)"
            >
              Ecretage
            </button>
          </div>
          <div className={styles.controlGroup}>
            <button type="button" className={styles.zoomBtn} onClick={handleZoomOut} disabled={zoom <= 0.101 && scaleMode !== 'p100' && scaleMode !== 'p200' || effectiveZoom <= 1.001 && (scaleMode === 'p100' || scaleMode === 'p200')} aria-label="Zoom arrière">−</button>
            <span className={styles.zoomValue}>{Math.round(effectiveZoom * 100)}%</span>
            <button type="button" className={styles.zoomBtn} onClick={handleZoomIn} disabled={zoom >= 7.999} aria-label="Zoom avant">+</button>
            <button type="button" className={styles.zoomReset} onClick={handleResetZoom} disabled={zoom === 1}>Reset</button>
          </div>
        </div>

        {src ? (
          <img
            ref={imgRef}
            className={scaleMode === 'fill' ? styles.imageFill : undefined}
            src={src}
            alt={photo.filename}
            draggable={false}
            onLoad={updateBounds}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${effectiveZoom})`, transformOrigin: 'center center' }}
          />
        ) : (
          <div className={styles.loading}>Chargement…</div>
        )}

        {/* Subtle loading indicator — shown over existing image, not replacing it */}
        {loading && src && <div className={styles.loadingDot} />}

        {/* Clipping overlay — positioned and transformed to exactly match the image */}
        {showClipping && src && imgBounds && (
          <canvas
            ref={clippingCanvasRef}
            className={styles.clippingCanvas}
            style={{
              left: imgBounds.x,
              top: imgBounds.y,
              width: imgBounds.w,
              height: imgBounds.h,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${effectiveZoom})`,
              transformOrigin: 'center center',
            }}
          />
        )}

        {colorMaskPreview && imgBounds && (
          <img
            src={colorMaskPreview}
            alt="color-mask"
            className={styles.colorMask}
            style={{ left: imgBounds.x, top: imgBounds.y, width: imgBounds.w, height: imgBounds.h }}
            draggable={false}
          />
        )}

        {/* SVG overlay for radial filters */}
        {imgBounds && localAdjs.length > 0 && (
          <svg
            className={styles.overlay + (colorPickLocalId !== null ? ' ' + styles.overlayPickMode + ' ' + styles.pipetteCursor : '')}
            onPointerMove={handleSvgPointerMove}
            onPointerUp={handleSvgPointerUp}
            onPointerCancel={handleSvgPointerUp}
            onClick={handleSvgClick}
            onDoubleClick={handleSvgDoubleClick}
          >
            {[
              ...localAdjs.filter((adj) => adj.id !== selectedLocalId),
              ...localAdjs.filter((adj) => adj.id === selectedLocalId),
            ].map(adj => {
              const isSelected = adj.id === selectedLocalId
              const isDrawingThis = drawingLasso?.id === adj.id

              if (adj.kind === 'lasso') {
                const isDraggingThis = draggingLasso?.id === adj.id
                const points = isDrawingThis
                  ? drawingLasso.points
                  : (isDraggingThis ? draggingLasso.points : parseLassoPoints(adj.points_json))
                const scaled = points.map((p) => ({ x: imgBounds.x + p.x * imgBounds.w, y: imgBounds.y + p.y * imgBounds.h }))
                const pointsAttr = scaled.map((p) => `${p.x},${p.y}`).join(' ')

                return (
                  <g
                    key={adj.id}
                    onClick={(e) => { e.stopPropagation(); onSelectLocal(adj.id) }}
                    onDoubleClick={(e) => {
                      if (!isSelected) return
                      e.stopPropagation()
                      setDrawingLasso({ id: adj.id, points: [] })
                    }}
                    style={isDrawingThis ? { pointerEvents: 'none' } : undefined}
                  >
                    {points.length >= 3 ? (
                      <polygon
                        points={pointsAttr}
                        fill={isDrawingThis ? 'rgba(232,160,32,0.04)' : (isDraggingThis ? 'rgba(232,160,32,0.18)' : 'rgba(232,160,32,0.08)')}
                        stroke={isSelected ? '#e8a020' : 'rgba(255,255,255,0.5)'}
                        strokeWidth={isSelected ? 2 : 1}
                        strokeDasharray={isSelected ? undefined : '4 3'}
                        style={{ cursor: 'move' }}
                        onMouseDown={(e) => handleInsertLassoPoint(e, adj)}
                      />
                    ) : (
                      <polyline
                        points={pointsAttr}
                        fill="none"
                        stroke="#e8a020"
                        strokeWidth={2}
                        strokeDasharray="4 3"
                      />
                    )}

                    {isSelected && !isDrawingThis && scaled.map((p, idx) => (
                      <circle
                        key={`${adj.id}-pt-${idx}`}
                        cx={p.x}
                        cy={p.y}
                        r={6}
                        fill="#e8a020"
                        stroke="#fff"
                        strokeWidth={1}
                        style={{ cursor: 'move' }}
                        onPointerDown={(e) => {
                          e.stopPropagation()
                          activePointerIdRef.current = e.pointerId
                          e.currentTarget.setPointerCapture(e.pointerId)
                          const svg = e.currentTarget.closest('svg')
                          if (!svg) return
                          dragRef.current = {
                            type: 'lasso-point',
                            id: adj.id,
                            pointIndex: idx,
                            startPoints: points,
                            startMx: e.clientX - svg.getBoundingClientRect().left,
                            startMy: e.clientY - svg.getBoundingClientRect().top,
                          }
                        }}
                      />
                    ))}
                  </g>
                )
              }

              if (adj.kind === 'color') {
                return null
              }

              const cx = imgBounds.x + adj.cx * imgBounds.w
              const cy = imgBounds.y + adj.cy * imgBounds.h
              const rx = adj.rx * imgBounds.w
              const ry = adj.ry * imgBounds.h

              return (
                <g key={adj.id} onClick={(e) => { e.stopPropagation(); onSelectLocal(adj.id) }}>
                  {/* Ellipse body */}
                  <ellipse
                    cx={cx} cy={cy} rx={rx} ry={ry}
                    fill="none"
                    stroke={isSelected ? '#e8a020' : 'rgba(255,255,255,0.5)'}
                    strokeWidth={isSelected ? 2 : 1}
                    strokeDasharray={isSelected ? undefined : '4 3'}
                    style={{ cursor: 'move' }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      onSelectLocal(adj.id)
                      dragRef.current = { type: 'move', id: adj.id, startCx: adj.cx, startCy: adj.cy, startMx: e.clientX - e.currentTarget.closest('svg')!.getBoundingClientRect().left, startMy: e.clientY - e.currentTarget.closest('svg')!.getBoundingClientRect().top }
                    }}
                  />
                  {/* Center dot */}
                  <circle cx={cx} cy={cy} r={4} fill={isSelected ? '#e8a020' : 'rgba(255,255,255,0.6)'} style={{ cursor: 'move' }}
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      onSelectLocal(adj.id)
                      dragRef.current = { type: 'move', id: adj.id, startCx: adj.cx, startCy: adj.cy, startMx: e.clientX - e.currentTarget.closest('svg')!.getBoundingClientRect().left, startMy: e.clientY - e.currentTarget.closest('svg')!.getBoundingClientRect().top }
                    }}
                  />
                  {/* Resize handles (only when selected) */}
                  {isSelected && (<>
                    {/* Right handle */}
                    <circle cx={cx + rx} cy={cy} r={6} fill="#e8a020" stroke="#fff" strokeWidth={1} style={{ cursor: 'ew-resize' }}
                      onMouseDown={(e) => { e.stopPropagation(); dragRef.current = { type: 'resize-x', id: adj.id, startRx: adj.rx, startMx: e.clientX - e.currentTarget.closest('svg')!.getBoundingClientRect().left, sign: 1 } }} />
                    {/* Left handle */}
                    <circle cx={cx - rx} cy={cy} r={6} fill="#e8a020" stroke="#fff" strokeWidth={1} style={{ cursor: 'ew-resize' }}
                      onMouseDown={(e) => { e.stopPropagation(); dragRef.current = { type: 'resize-x', id: adj.id, startRx: adj.rx, startMx: e.clientX - e.currentTarget.closest('svg')!.getBoundingClientRect().left, sign: -1 } }} />
                    {/* Bottom handle */}
                    <circle cx={cx} cy={cy + ry} r={6} fill="#e8a020" stroke="#fff" strokeWidth={1} style={{ cursor: 'ns-resize' }}
                      onMouseDown={(e) => { e.stopPropagation(); dragRef.current = { type: 'resize-y', id: adj.id, startRy: adj.ry, startMy: e.clientY - e.currentTarget.closest('svg')!.getBoundingClientRect().top, sign: 1 } }} />
                    {/* Top handle */}
                    <circle cx={cx} cy={cy - ry} r={6} fill="#e8a020" stroke="#fff" strokeWidth={1} style={{ cursor: 'ns-resize' }}
                      onMouseDown={(e) => { e.stopPropagation(); dragRef.current = { type: 'resize-y', id: adj.id, startRy: adj.ry, startMy: e.clientY - e.currentTarget.closest('svg')!.getBoundingClientRect().top, sign: -1 } }} />
                  </>)}
                </g>
              )
            })}

            {drawingLasso && (() => {
              const scaled = drawingLasso.points.map((p) => ({ x: imgBounds.x + p.x * imgBounds.w, y: imgBounds.y + p.y * imgBounds.h }))
              const pointsAttr = scaled.map((p) => `${p.x},${p.y}`).join(' ')
              return (
                <g>
                  <polyline points={pointsAttr} fill="none" stroke="#e8a020" strokeWidth={2} strokeDasharray="5 4" />
                  {scaled.map((p, idx) => (
                    <circle
                      key={`draw-${idx}`}
                      cx={p.x}
                      cy={p.y}
                      r={idx === 0 ? 6 : 4}
                      fill={idx === 0 ? '#f2be56' : '#e8a020'}
                      stroke={idx === 0 ? '#fff' : undefined}
                      strokeWidth={idx === 0 ? 1 : undefined}
                      style={idx === 0 ? { cursor: 'pointer' } : undefined}
                    />
                  ))}
                  <text x={imgBounds.x + 12} y={imgBounds.y + 20} fill="#e8a020" fontSize={12} fontWeight={600}>
                    Mode lasso: clic pour ajouter, clic sur le 1er point ou double-clic pour fermer, Option/Cmd/Ctrl + clic contour pour inserer
                  </text>
                </g>
              )
            })()}

            {colorPickLocalId !== null && (() => {
              const selected = localAdjs.find((a) => a.id === colorPickLocalId)
              if (!selected || selected.kind !== 'color') return null
              return (
                <g>
                  <text x={imgBounds.x + 12} y={imgBounds.y + 20} fill="#e8a020" fontSize={12} fontWeight={600}>
                    Pipette: clique sur l'image pour prelever une couleur
                  </text>
                </g>
              )
            })()}
          </svg>
        )}
      </div>

      <div className={styles.exifBar}>
        {photo.camera_make && (
          <span>{photo.camera_make} {photo.camera_model}</span>
        )}
        {photo.focal_length && <span>{photo.focal_length}mm</span>}
        {photo.aperture && <span>f/{photo.aperture}</span>}
        {photo.shutter_speed && <span>{photo.shutter_speed}s</span>}
        {photo.iso && <span>ISO {photo.iso}</span>}
        {photo.date_taken && (
          <span>{new Date(photo.date_taken).toLocaleDateString('fr-FR')}</span>
        )}
        <span className={styles.filename}>{photo.filename}</span>
      </div>
    </div>
  )
}
