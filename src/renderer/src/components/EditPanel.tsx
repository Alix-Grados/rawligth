import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditParams, Photo, LocalAdjustment } from '../types'
import { DEFAULT_EDITS } from '../types'
import styles from './EditPanel.module.css'

interface Props {
  photo: Photo
  localAdjs: LocalAdjustment[]
  selectedLocalId: number | null
  onEditsChanged: () => void
  onLocalsChanged: (adjs: LocalAdjustment[]) => void
  onSelectLocal: (id: number | null) => void
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}

function Slider({ label, value, min, max, onChange }: SliderProps): React.JSX.Element {
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderHeader}>
        <span className={styles.sliderLabel}>{label}</span>
        <span className={styles.sliderValue}>{value > 0 ? `+${value}` : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export function EditPanel({ photo, localAdjs, selectedLocalId, onEditsChanged, onLocalsChanged, onSelectLocal }: Props): React.JSX.Element {
  const [edits, setEdits] = useState<EditParams>(DEFAULT_EDITS)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastPhotoId = useRef<number | null>(null)

  useEffect(() => {
    if (lastPhotoId.current === photo.id) return
    lastPhotoId.current = photo.id
    ;(async () => {
      const saved = await window.api.getEdits(photo.id) as EditParams
      setEdits(saved)
    })()
  }, [photo.id])

  const updateEdit = useCallback(
    (key: keyof EditParams, value: number) => {
      setEdits((prev) => {
        const next = { ...prev, [key]: value }
        if (saveTimer.current) clearTimeout(saveTimer.current)
        saveTimer.current = setTimeout(async () => {
          await window.api.saveEdits(photo.id, next)
          onEditsChanged()
        }, 400)
        return next
      })
    },
    [photo.id, onEditsChanged]
  )

  const handleReset = async (): Promise<void> => {
    const fresh = await window.api.resetEdits(photo.id) as EditParams
    setEdits(fresh)
    onEditsChanged()
  }

  const handleExport = async (format: 'jpeg' | 'png'): Promise<void> => {
    setExporting(true)
    setExportMsg(null)
    const result = await window.api.exportImage(photo.id, { format, quality: 90 })
    setExporting(false)
    if (result.success) {
      setExportMsg(`✓ Exporté : ${result.path?.split('/').pop()}`)
    } else {
      setExportMsg(result.error === 'Cancelled' ? null : `Erreur : ${result.error}`)
    }
    setTimeout(() => setExportMsg(null), 4000)
  }

  // ---------- Local adjustments ----------
  const handleAddRadial = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id) as LocalAdjustment
    onLocalsChanged([...localAdjs, adj])
    onSelectLocal(adj.id)
  }

  const handleDeleteLocal = async (id: number): Promise<void> => {
    await window.api.deleteLocalAdj(id)
    const updated = localAdjs.filter(a => a.id !== id)
    onLocalsChanged(updated)
    if (selectedLocalId === id) onSelectLocal(null)
    onEditsChanged()
  }

  const updateLocalEdit = useCallback(
    (id: number, key: keyof Omit<LocalAdjustment, 'id' | 'photo_id' | 'cx' | 'cy' | 'rx' | 'ry' | 'feather' | 'invert'>, value: number) => {
      const updated = localAdjs.map(a => a.id === id ? { ...a, [key]: value } : a)
      onLocalsChanged(updated)
      if (localSaveTimer.current) clearTimeout(localSaveTimer.current)
      localSaveTimer.current = setTimeout(async () => {
        const adj = updated.find(a => a.id === id)
        if (adj) {
          await window.api.updateLocalAdj(adj)
          onEditsChanged()
        }
      }, 400)
    },
    [localAdjs, onLocalsChanged, onEditsChanged]
  )

  const updateLocalShape = useCallback(
    (id: number, key: 'feather' | 'invert', value: number) => {
      const updated = localAdjs.map(a => a.id === id ? { ...a, [key]: value } : a)
      onLocalsChanged(updated)
      if (localSaveTimer.current) clearTimeout(localSaveTimer.current)
      localSaveTimer.current = setTimeout(async () => {
        const adj = updated.find(a => a.id === id)
        if (adj) {
          await window.api.updateLocalAdj(adj)
          onEditsChanged()
        }
      }, 400)
    },
    [localAdjs, onLocalsChanged, onEditsChanged]
  )

  const selectedAdj = localAdjs.find(a => a.id === selectedLocalId) ?? null

  return (
    <div className={styles.panel}>
      <div className={styles.panelTitle}>Développement</div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Lumière</div>
        <Slider label="Exposition" value={Math.round(edits.exposure * 10) / 10} min={-50} max={50} onChange={(v) => updateEdit('exposure', v / 10)} />
        <Slider label="Contraste" value={edits.contrast} min={-100} max={100} onChange={(v) => updateEdit('contrast', v)} />
        <Slider label="Hautes lumières" value={edits.highlights} min={-100} max={100} onChange={(v) => updateEdit('highlights', v)} />
        <Slider label="Ombres" value={edits.shadows} min={-100} max={100} onChange={(v) => updateEdit('shadows', v)} />
        <Slider label="Blancs" value={edits.whites} min={-100} max={100} onChange={(v) => updateEdit('whites', v)} />
        <Slider label="Noirs" value={edits.blacks} min={-100} max={100} onChange={(v) => updateEdit('blacks', v)} />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Couleur</div>
        <Slider label="Température" value={edits.temperature} min={-100} max={100} onChange={(v) => updateEdit('temperature', v)} />
        <Slider label="Teinte" value={edits.tint} min={-100} max={100} onChange={(v) => updateEdit('tint', v)} />
        <Slider label="Saturation" value={edits.saturation} min={-100} max={100} onChange={(v) => updateEdit('saturation', v)} />
        <Slider label="Vibrance" value={edits.vibrance} min={-100} max={100} onChange={(v) => updateEdit('vibrance', v)} />
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Détail</div>
        <Slider label="Netteté" value={edits.sharpness} min={0} max={100} onChange={(v) => updateEdit('sharpness', v)} />
        <Slider label="Réduction du bruit" value={edits.noise_reduction} min={0} max={100} onChange={(v) => updateEdit('noise_reduction', v)} />
      </div>

      <div className={styles.actions}>
        <button className={styles.resetBtn} onClick={handleReset}>
          Réinitialiser
        </button>
      </div>

      {/* ---------- Filtres locaux ---------- */}
      <div className={styles.group}>
        <div className={styles.localHeader}>
          <div className={styles.groupTitle}>Filtres locaux</div>
          <button className={styles.addLocalBtn} onClick={handleAddRadial} title="Ajouter un filtre radial">+</button>
        </div>
        {localAdjs.map((adj, i) => (
          <div
            key={adj.id}
            className={styles.localItem + (adj.id === selectedLocalId ? ' ' + styles.localItemActive : '')}
            onClick={() => onSelectLocal(adj.id === selectedLocalId ? null : adj.id)}
          >
            <span className={styles.localIcon}>◎</span>
            <span className={styles.localName}>Filtre radial {i + 1}</span>
            <button
              className={styles.localDelete}
              onClick={(e) => { e.stopPropagation(); handleDeleteLocal(adj.id) }}
              title="Supprimer"
            >✕</button>
          </div>
        ))}
      </div>

      {/* Sliders for selected local adjustment */}
      {selectedAdj && (
        <div className={styles.localSliders}>
          <div className={styles.group}>
            <div className={styles.groupTitle}>Forme</div>
            <Slider label="Adoucissement" value={Math.round(selectedAdj.feather * 100)} min={0} max={100} onChange={(v) => updateLocalShape(selectedAdj.id, 'feather', v / 100)} />
            <div className={styles.sliderRow}>
              <label className={styles.invertToggle}>
                <input type="checkbox" checked={selectedAdj.invert === 1} onChange={(e) => updateLocalShape(selectedAdj.id, 'invert', e.target.checked ? 1 : 0)} />
                <span>Inverser (effet à l'extérieur)</span>
              </label>
            </div>
          </div>
          <div className={styles.group}>
            <div className={styles.groupTitle}>Lumière locale</div>
            <Slider label="Exposition" value={Math.round(selectedAdj.exposure * 10) / 10} min={-50} max={50} onChange={(v) => updateLocalEdit(selectedAdj.id, 'exposure', v / 10)} />
            <Slider label="Contraste" value={selectedAdj.contrast} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'contrast', v)} />
            <Slider label="Hautes lumières" value={selectedAdj.highlights} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'highlights', v)} />
            <Slider label="Ombres" value={selectedAdj.shadows} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'shadows', v)} />
          </div>
          <div className={styles.group}>
            <div className={styles.groupTitle}>Couleur locale</div>
            <Slider label="Saturation" value={selectedAdj.saturation} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'saturation', v)} />
            <Slider label="Température" value={selectedAdj.temperature} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'temperature', v)} />
          </div>
        </div>
      )}

      <div className={styles.exportSection}>
        <div className={styles.groupTitle}>Exporter</div>
        <div className={styles.exportBtns}>
          <button className={styles.exportBtn} onClick={() => handleExport('jpeg')} disabled={exporting}>JPEG</button>
          <button className={styles.exportBtn} onClick={() => handleExport('png')} disabled={exporting}>PNG</button>
        </div>
        {exportMsg && <div className={styles.exportMsg}>{exportMsg}</div>}
      </div>
    </div>
  )
}
