import styles from './Toolbar.module.css'

type ViewMode = 'grid' | 'detail'

interface Props {
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  photoCount: number
  currentFolder: string | null
}

export function Toolbar({ viewMode, onViewModeChange, photoCount, currentFolder }: Props): React.JSX.Element {
  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        {currentFolder && (
          <span className={styles.folderLabel}>
            {currentFolder.split('/').pop()}
            <span className={styles.count}>{photoCount} photo{photoCount !== 1 ? 's' : ''}</span>
          </span>
        )}
      </div>
      <div className={styles.right}>
        <div className={styles.viewToggle}>
          <button
            className={styles.viewBtn + (viewMode === 'grid' ? ' ' + styles.active : '')}
            onClick={() => onViewModeChange('grid')}
            title="Vue grille"
          >
            ⊞
          </button>
          <button
            className={styles.viewBtn + (viewMode === 'detail' ? ' ' + styles.active : '')}
            onClick={() => onViewModeChange('detail')}
            title="Vue détail"
          >
            ⊡
          </button>
        </div>
      </div>
    </div>
  )
}
