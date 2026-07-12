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
}

type DragState =
  | { type: 'move'; id: number; startCx: number; startCy: number; startMx: number; startMy: number }
  | { type: 'resize-x'; id: number; startRx: number; startMx: number; sign: 1 | -1 }
  | { type: 'resize-y'; id: number; startRy: number; startMy: number; sign: 1 | -1 }
  | null

export function DetailView({ photo, previewRevision, localAdjs, selectedLocalId, onSelectLocal, onUpdateLocalPosition }: Props): React.JSX.Element {
  // src always holds the LAST successfully loaded image — never set to null
  const [src, setSrc] = useState<string | null>(photo.thumbnail)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [imgBounds, setImgBounds] = useState<ImageBounds | null>(null)
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
    }
  }, [imgBounds, localAdjs, onUpdateLocalPosition])

  const handleSvgMouseUp = useCallback(() => {
    dragRef.current = null
  }, [])

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
          >
            {localAdjs.map(adj => {
              const cx = imgBounds.x + adj.cx * imgBounds.w
              const cy = imgBounds.y + adj.cy * imgBounds.h
              const rx = adj.rx * imgBounds.w
              const ry = adj.ry * imgBounds.h
              const isSelected = adj.id === selectedLocalId

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
