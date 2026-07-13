import { useCallback, useEffect, useRef, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { PhotoGrid } from './components/PhotoGrid'
import { DetailView } from './components/DetailView'
import { EditPanel } from './components/EditPanel'
import type { Photo, LocalAdjustment } from './types'
import styles from './App.module.css'

type ViewMode = 'grid' | 'detail'

function App(): React.JSX.Element {
  const [currentFolder, setCurrentFolder] = useState<string | null>(null)
  const [photos, setPhotos] = useState<Photo[]>([])
  const [selectedPhoto, setSelectedPhoto] = useState<Photo | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('detail')
  const [loading, setLoading] = useState(false)
  const [localAdjs, setLocalAdjs] = useState<LocalAdjustment[]>([])
  const [selectedLocalId, setSelectedLocalId] = useState<number | null>(null)
  const [colorPickLocalId, setColorPickLocalId] = useState<number | null>(null)
  const previewRevision = useRef(0)
  const [, setPreviewRev] = useState(0)
  const [zoomLabel, setZoomLabel] = useState('Ajusté')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [editCollapsed, setEditCollapsed] = useState(false)
  const localPersistTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const bumpPreview = useCallback(() => {
    previewRevision.current += 1
    setPreviewRev(previewRevision.current)
  }, [])

  const loadFolder = useCallback(async (folder: string) => {
    setLoading(true)
    setCurrentFolder(folder)
    setPhotos([])

    const accumulated: Photo[] = []
    const cleanup = window.api.onPhotoReady((photo) => {
      accumulated.push(photo as Photo)
      setPhotos([...accumulated])
    })

    await window.api.importFolder(folder)
    cleanup()

    // Final authoritative fetch — correct sort order (date_taken desc)
    const loaded = await window.api.getPhotosByFolder(folder) as Photo[]
    setPhotos(loaded)
    setSelectedPhoto((prev) => {
      if (prev) {
        const updated = loaded.find((p) => p.id === prev.id)
        return updated ?? (loaded[0] ?? null)
      }
      return loaded[0] ?? null
    })
    setViewMode('detail')
    setLoading(false)
  }, [])

  const handleSelectPhoto = useCallback(async (photo: Photo) => {
    setSelectedPhoto(photo)
    setSelectedLocalId(null)
    setColorPickLocalId(null)
    setViewMode('detail')
    const adjs = await window.api.getLocalAdjs(photo.id) as LocalAdjustment[]
    setLocalAdjs(adjs)
  }, [])

  const handleEditsChanged = useCallback(() => {
    bumpPreview()
  }, [bumpPreview])

  const scheduleLocalPersist = useCallback((adj: LocalAdjustment, refreshPreview: boolean = true) => {
    const existing = localPersistTimers.current[adj.id]
    if (existing) clearTimeout(existing)
    localPersistTimers.current[adj.id] = setTimeout(async () => {
      const ok = await window.api.updateLocalAdj(adj)
      if (ok && refreshPreview) bumpPreview()
    }, 120)
  }, [bumpPreview])

  const handleUpdateLocalPosition = useCallback((id: number, cx: number, cy: number, rx: number, ry: number) => {
    setLocalAdjs((prev) => {
      let nextAdj: LocalAdjustment | null = null
      const next = prev.map((a) => {
        if (a.id !== id) return a
        nextAdj = { ...a, cx, cy, rx, ry }
        return nextAdj
      })
      if (nextAdj) scheduleLocalPersist(nextAdj)
      return next
    })
  }, [scheduleLocalPersist])

  const handleUpdateLocalPoints = useCallback((id: number, points_json: string, refreshPreview: boolean = true) => {
    setLocalAdjs((prev) => {
      let nextAdj: LocalAdjustment | null = null
      const next = prev.map((a) => {
        if (a.id !== id) return a
        nextAdj = { ...a, points_json }
        return nextAdj
      })
      if (nextAdj) scheduleLocalPersist(nextAdj, refreshPreview)
      return next
    })
  }, [scheduleLocalPersist])

  const handlePickLocalColor = useCallback((id: number, r: number, g: number, b: number) => {
    setLocalAdjs((prev) => {
      let nextAdj: LocalAdjustment | null = null
      const next = prev.map((a) => {
        if (a.id !== id) return a
        nextAdj = { ...a, target_r: r, target_g: g, target_b: b }
        return nextAdj
      })
      if (nextAdj) scheduleLocalPersist(nextAdj, true)
      return next
    })
  }, [scheduleLocalPersist])

  useEffect(() => {
    const lastFolder = localStorage.getItem('rawlight_last_folder')
    if (lastFolder) {
      loadFolder(lastFolder)
    }
  }, [loadFolder])

  useEffect(() => {
    if (currentFolder) {
      localStorage.setItem('rawlight_last_folder', currentFolder)
    }
  }, [currentFolder])

  useEffect(() => {
    return () => {
      Object.values(localPersistTimers.current).forEach((timer) => clearTimeout(timer))
    }
  }, [])

  return (
    <div className={styles.app}>
      <div className={sidebarCollapsed ? styles.sidebarWrapCollapsed : styles.sidebarWrap}>
        <Sidebar
          currentFolder={currentFolder}
          photos={photos}
          onSelectFolder={loadFolder}
        />
      </div>
      <button
        className={styles.collapseLeft}
        onClick={() => setSidebarCollapsed(v => !v)}
        title={sidebarCollapsed ? 'Afficher la barre latérale' : 'Masquer la barre latérale'}
      >
        {sidebarCollapsed ? '›' : '‹'}
      </button>

      <div className={styles.main}>
        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          photoCount={photos.length}
          currentFolder={currentFolder}
        />

        <div className={styles.content}>
          {loading && photos.length === 0 && (
            <div className={styles.loadingOverlay}>Importation en cours...</div>
          )}

          {viewMode === 'grid' ? (
            <PhotoGrid
              photos={photos}
              selectedId={selectedPhoto?.id ?? null}
              onSelect={handleSelectPhoto}
            />
          ) : (
            <div className={styles.detailWrapper}>
              {selectedPhoto ? (
                <>
                  <DetailView
                    photo={selectedPhoto}
                    previewRevision={previewRevision.current}
                    localAdjs={localAdjs}
                    selectedLocalId={selectedLocalId}
                    colorPickLocalId={colorPickLocalId}
                    onSelectLocal={setSelectedLocalId}
                    onUpdateLocalPosition={handleUpdateLocalPosition}
                    onUpdateLocalPoints={handleUpdateLocalPoints}
                    onPickLocalColor={handlePickLocalColor}
                    onStopColorPick={() => setColorPickLocalId(null)}
                    onZoomChange={setZoomLabel}
                  />
                  <button
                    className={styles.collapseRight}
                    onClick={() => setEditCollapsed(v => !v)}
                    title={editCollapsed ? 'Afficher les réglages' : 'Masquer les réglages'}
                  >
                    {editCollapsed ? '‹' : '›'}
                  </button>
                  <div className={editCollapsed ? styles.editWrapCollapsed : styles.editWrap}>
                    <EditPanel
                      photo={selectedPhoto}
                      localAdjs={localAdjs}
                      selectedLocalId={selectedLocalId}
                      colorPickLocalId={colorPickLocalId}
                      onEditsChanged={handleEditsChanged}
                      onLocalsChanged={setLocalAdjs}
                      onSelectLocal={setSelectedLocalId}
                      onStartColorPick={setColorPickLocalId}
                    />
                  </div>
                </>
              ) : (
                <div className={styles.noSelection}>Selectionnez une photo dans la grille</div>
              )}
            </div>
          )}
        </div>

        {viewMode === 'detail' && photos.length > 0 && (
          <div className={styles.filmstrip}>
            {photos.map((p) => (
              <div
                key={p.id}
                className={styles.strip + (p.id === selectedPhoto?.id ? ' ' + styles.stripActive : '')}
                onClick={() => handleSelectPhoto(p)}
              >
                {p.thumbnail ? (
                  <img src={p.thumbnail} alt={p.filename} draggable={false} />
                ) : (
                  <div className={styles.stripEmpty}>RAW</div>
                )}
              </div>
            ))}
          </div>
        )}

        {viewMode === 'detail' && selectedPhoto && (
          <div className={styles.statusBar}>
            <span>{selectedPhoto.filename}</span>
            <span className={styles.statusSep}>·</span>
            <span>{zoomLabel}</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
