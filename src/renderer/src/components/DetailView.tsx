import { useEffect, useRef, useState } from 'react'
import type { Photo } from '../types'
import styles from './DetailView.module.css'

interface Props {
  photo: Photo
}

export function DetailView({ photo }: Props): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(photo.thumbnail)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    setSrc(photo.thumbnail)
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    let cancelled = false
    ;(async () => {
      const preview = await window.api.getPreview(photo.id, 1600)
      if (cancelled) return
      if (preview) setSrc(preview)
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [photo.id])

  return (
    <div className={styles.container}>
      <div className={styles.imageWrap}>
        {src ? (
          <img src={src} alt={photo.filename} draggable={false} />
        ) : (
          <div className={styles.loading}>Chargement…</div>
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
