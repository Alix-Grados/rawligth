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
  onSelectLocal: (id: number) => void
  onUpdateLocalPosition: (id: number, cx: number, cy: number, rx: number, ry: number) => void
  onUpdateLocalPoints: (id: number, points_json: string) => void
}

type DragState =
  | { type: 'move'; id: number; startCx: number; startCy: number; startMx: number; startMy: number }
  | { type: 'resize-x'; id: number; startRx: number; startMx: number; sign: 1 | -1 }
  | { type: 'resize-y'; id: number; startRy: number; startMy: number; sign: 1 | -1 }
  | { type: 'lasso-point'; id: number; pointIndex: number; startPoints: Array<{ x: number; y: number }>; startMx: number; startMy: number }
  | null

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

export function DetailView({ photo, previewRevision, localAdjs, selectedLocalId, onSelectLocal, onUpdateLocalPosition, onUpdateLocalPoints }: Props): React.JSX.Element {
  // src always holds the LAST successfully loaded image — never set to null
  const [src, setSrc] = useState<string | null>(photo.thumbnail)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgBounds, setImgBounds] = useState<ImageBounds | null>(null)
  const [drawingLasso, setDrawingLasso] = useState<{ id: number; points: Array<{ x: number; y: number }> } | null>(null)
  const dragRef = useRef<DragState>(null)
  // Track the last photo id to reset src when switching photos
  const lastPhotoId = useRef<number | null>(null)

  // Load preview — keep old src visible until new one arrives
  useEffect(() => {
    // Only reset to thumbnail when switching photos, not on edits refresh
    if (lastPhotoId.current !== photo.id) {
      lastPhotoId.current = photo.id
      setSrc(photo.thumbnail)
    }

    setLoading(true)
    let cancelled = false
    ;(async () => {
      const preview = await window.api.getPreview(photo.id, 1600)
      if (cancelled) return
      if (preview) setSrc(preview)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [photo.id, previewRevision])

  useEffect(() => {
    if (!drawingLasso) return
    const selected = localAdjs.find((a) => a.id === selectedLocalId)
    if (!selected || selected.kind !== 'lasso' || selected.id !== drawingLasso.id) {
      setDrawingLasso(null)
    }
  }, [drawingLasso, localAdjs, selectedLocalId])

  // Compute actual image bounds within container (object-fit: contain)
  const updateBounds = useCallback(() => {
    const img = imgRef.current
    const container = containerRef.current
    if (!img || !container) return
    const cr = container.getBoundingClientRect()
    const ir = img.getBoundingClientRect()
    setImgBounds({ x: ir.left - cr.left, y: ir.top - cr.top, w: ir.width, h: ir.height })
  }, [])

  useEffect(() => {
    const ro = new ResizeObserver(updateBounds)
    if (containerRef.current) ro.observe(containerRef.current)
    if (imgRef.current) ro.observe(imgRef.current)
    updateBounds()
    return () => ro.disconnect()
  }, [src, updateBounds])

  // Mouse events for drag/resize
  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
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
      onUpdateLocalPoints(drag.id, JSON.stringify(next))
    }
  }, [imgBounds, localAdjs, onUpdateLocalPosition, onUpdateLocalPoints])

  const handleSvgMouseUp = useCallback(() => {
    dragRef.current = null
  }, [])

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

  const handleSvgClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
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
  }, [drawingLasso, finalizeDrawing, imgBounds, normalizedPointFromEvent])

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
    <div className={styles.container}>
      <div className={styles.imageWrap} ref={containerRef}>
        {src ? (
          <img ref={imgRef} src={src} alt={photo.filename} draggable={false} onLoad={updateBounds} />
        ) : (
          <div className={styles.loading}>Chargement…</div>
        )}

        {/* Subtle loading indicator — shown over existing image, not replacing it */}
        {loading && src && <div className={styles.loadingDot} />}

        {/* SVG overlay for radial filters */}
        {imgBounds && localAdjs.length > 0 && (
          <svg
            className={styles.overlay}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onMouseLeave={handleSvgMouseUp}
            onClick={handleSvgClick}
            onDoubleClick={handleSvgDoubleClick}
          >
            {localAdjs.map(adj => {
              const isSelected = adj.id === selectedLocalId
              const isDrawingThis = drawingLasso?.id === adj.id

              if (adj.kind === 'lasso') {
                const points = isDrawingThis ? drawingLasso.points : parseLassoPoints(adj.points_json)
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
                        fill={isDrawingThis ? 'rgba(232,160,32,0.04)' : 'rgba(232,160,32,0.08)'}
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
                        onMouseDown={(e) => {
                          e.stopPropagation()
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
