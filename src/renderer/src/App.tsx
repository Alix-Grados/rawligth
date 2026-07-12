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
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [loading, setLoading] = useState(false)
  const [localAdjs, setLocalAdjs] = useState<LocalAdjustment[]>([])
  const [selectedLocalId, setSelectedLocalId] = useState<number | null>(null)
  const previewRevision = useRef(0)
  const [, setPreviewRev] = useState(0)

  const loadFolder = useCallback(async (folder: string) => {
    setLoading(true)
    setCurrentFolder(folder)
    await window.api.importFolder(folder)
    const loaded = await window.api.getPhotosByFolder(folder) as Photo[]
    setPhotos(loaded)
    setSelectedPhoto((prev) => {
      if (prev) {
        const updated = loaded.find((p) => p.id === prev.id)
        return updated ?? (loaded[0] ?? null)
      }
      return loaded[0] ?? null
    })
    setLoading(false)
  }, [])

  const handleSelectPhoto = useCallback(async (photo: Photo) => {
    setSelectedPhoto(photo)
    setSelectedLocalId(null)
    setViewMode('detail')
    const adjs = await window.api.getLocalAdjs(photo.id) as LocalAdjustment[]
    setLocalAdjs(adjs)
  }, [])

  const handleEditsChanged = useCallback(() => {
    previewRevision.current += 1
    setPreviewRev(previewRevision.current)
  }, [])

  const handleUpdateLocalPosition = useCallback(async (id: number, cx: number, cy: number, rx: number, ry: number) => {
    setLocalAdjs(prev => prev.map(a => a.id === id ? { ...a, cx, cy, rx, ry } : a))
    const adj = localAdjs.find(a => a.id === id)
    if (adj) {
      await window.api.updateLocalAdj({ ...adj, cx, cy, rx, ry })
    }
  }, [localAdjs])

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

  return (
    <div className={styles.app}>
      <Sidebar
        currentFolder={currentFolder}
        photos={photos}
        onSelectFolder={loadFolder}
      />

      <div className={styles.main}>
        <Toolbar
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          photoCount={photos.length}
          currentFolder={currentFolder}
        />

        <div className={styles.content}>
          {loading && (
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
                    key={`${selectedPhoto.id}-${previewRevision.current}`}
                    photo={selectedPhoto}
                    localAdjs={localAdjs}
                    selectedLocalId={selectedLocalId}
                    onSelectLocal={setSelectedLocalId}
                    onUpdateLocalPosition={handleUpdateLocalPosition}
                  />
                  <EditPanel
                    photo={selectedPhoto}
                    localAdjs={localAdjs}
                    selectedLocalId={selectedLocalId}
                    onEditsChanged={handleEditsChanged}
                    onLocalsChanged={setLocalAdjs}
                    onSelectLocal={setSelectedLocalId}
                  />
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
      </div>
    </div>
  )
}

export default App
