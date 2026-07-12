import { useState } from 'react'
import type { Photo } from '../types'
import styles from './Sidebar.module.css'

interface Props {
  currentFolder: string | null
  photos: Photo[]
  onOpenFolder: () => void
  onSelectFolder: (folder: string) => void
}

export function Sidebar({ currentFolder, onOpenFolder }: Props): React.JSX.Element {
  const [recentFolders, setRecentFolders] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('rawlight_recent_folders') ?? '[]')
    } catch {
      return []
    }
  })

  const handleOpenFolder = async (): Promise<void> => {
    const folder = await window.api.openFolder()
    if (!folder) return
    const updated = [folder, ...recentFolders.filter((f) => f !== folder)].slice(0, 8)
    setRecentFolders(updated)
    localStorage.setItem('rawlight_recent_folders', JSON.stringify(updated))
    onOpenFolder()
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoIcon}>◈</span>
        <span className={styles.logoName}>Rawlight</span>
      </div>

      <button className={styles.importBtn} onClick={handleOpenFolder}>
        + Ouvrir un dossier
      </button>

      {currentFolder && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Dossier actif</div>
          <div className={styles.folderItem + ' ' + styles.active} title={currentFolder}>
            <span className={styles.folderIcon}>📁</span>
            <span className={styles.folderName}>{currentFolder.split('/').pop()}</span>
          </div>
        </div>
      )}

      {recentFolders.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Récents</div>
          {recentFolders.map((folder) => (
            <div
              key={folder}
              className={styles.folderItem + (folder === currentFolder ? ' ' + styles.active : '')}
              title={folder}
              onClick={async () => {
                await window.api.importFolder(folder)
                onOpenFolder()
              }}
            >
              <span className={styles.folderIcon}>📁</span>
              <span className={styles.folderName}>{folder.split('/').pop()}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
