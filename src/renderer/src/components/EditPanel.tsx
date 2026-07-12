import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditParams, Photo } from '../types'
import { DEFAULT_EDITS } from '../types'
import styles from './EditPanel.module.css'

interface Props {
  photo: Photo
  onEditsChanged: () => void
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

export function EditPanel({ photo, onEditsChanged }: Props): React.JSX.Element {
  const [edits, setEdits] = useState<EditParams>(DEFAULT_EDITS)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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

      <div className={styles.exportSection}>
        <div className={styles.groupTitle}>Exporter</div>
        <div className={styles.exportBtns}>
          <button
            className={styles.exportBtn}
            onClick={() => handleExport('jpeg')}
            disabled={exporting}
          >
            JPEG
          </button>
          <button
            className={styles.exportBtn}
            onClick={() => handleExport('png')}
            disabled={exporting}
          >
            PNG
          </button>
        </div>
        {exportMsg && <div className={styles.exportMsg}>{exportMsg}</div>}
      </div>
    </div>
  )
}
