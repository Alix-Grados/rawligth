import type { Photo } from '../types'
import styles from './PhotoGrid.module.css'

interface Props {
  photos: Photo[]
  selectedId: number | null
  onSelect: (photo: Photo) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PhotoGrid({ photos, selectedId, onSelect }: Props): React.JSX.Element {
  if (photos.length === 0) {
    return (
      <div className={styles.empty}>
        <div className={styles.emptyIcon}>◈</div>
        <div className={styles.emptyText}>Ouvrez un dossier pour commencer</div>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {photos.map((photo) => (
        <div
          key={photo.id}
          className={styles.cell + (photo.id === selectedId ? ' ' + styles.selected : '')}
          onClick={() => onSelect(photo)}
          title={photo.filename}
        >
          <div className={styles.thumb}>
            {photo.thumbnail ? (
              <img src={photo.thumbnail} alt={photo.filename} draggable={false} />
            ) : (
              <div className={styles.noThumb}>
                <span>RAW</span>
              </div>
            )}
          </div>
          <div className={styles.info}>
            <div className={styles.name}>{photo.filename}</div>
            <div className={styles.meta}>{formatSize(photo.size)}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
