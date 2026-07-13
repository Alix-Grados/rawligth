import { useCallback, useEffect, useRef, useState } from 'react'
import type { EditParams, Photo, LocalAdjustment } from '../types'
import { DEFAULT_EDITS } from '../types'
import styles from './EditPanel.module.css'

interface Props {
  photo: Photo
  localAdjs: LocalAdjustment[]
  selectedLocalId: number | null
  colorPickLocalId: number | null
  detouragePickMode: boolean
  detourageShowMask: boolean
  onEditsChanged: () => void
  onLocalsChanged: (adjs: LocalAdjustment[]) => void
  onSelectLocal: (id: number | null) => void
  onStartColorPick: (id: number | null) => void
  onStartDetouragePick: () => void
  onStopDetouragePick: () => void
  onToggleDetourageMask: () => void
  onExportDetourage: (bgMode: 'transparent' | 'white') => Promise<{ success: boolean; path?: string; error?: string }>
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  displayValue?: number
  onChange: (v: number) => void
}

type LocalNumericKey =
  | 'exposure'
  | 'contrast'
  | 'highlights'
  | 'shadows'
  | 'whites'
  | 'blacks'
  | 'temperature'
  | 'tint'
  | 'saturation'
  | 'vibrance'
  | 'sharpness'
  | 'noise_reduction'
  | 'target_r'
  | 'target_g'
  | 'target_b'
  | 'color_tolerance'

function toHexByte(v: number): string {
  return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
}

function Slider({ label, value, min, max, displayValue, onChange }: SliderProps): React.JSX.Element {
  const shown = displayValue ?? value
  return (
    <div className={styles.sliderRow}>
      <div className={styles.sliderHeader}>
        <span className={styles.sliderLabel}>{label}</span>
        <span className={styles.sliderValue}>{shown > 0 ? `+${shown}` : shown}</span>
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

export function EditPanel({ photo, localAdjs, selectedLocalId, colorPickLocalId, detouragePickMode, detourageShowMask, onEditsChanged, onLocalsChanged, onSelectLocal, onStartColorPick, onStartDetouragePick, onStopDetouragePick, onToggleDetourageMask, onExportDetourage }: Props): React.JSX.Element {
  const [edits, setEdits] = useState<EditParams>(DEFAULT_EDITS)
  const [activeTab, setActiveTab] = useState<'global' | 'local'>('global')
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [detourageExporting, setDetourageExporting] = useState(false)
  const [detourageExportMsg, setDetourageExportMsg] = useState<string | null>(null)
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

  const handleDetourageExport = async (bgMode: 'transparent' | 'white'): Promise<void> => {
    setDetourageExporting(true)
    setDetourageExportMsg(null)
    const result = await onExportDetourage(bgMode)
    setDetourageExporting(false)
    if (result.success) {
      setDetourageExportMsg(`✓ Exporté : ${result.path?.split('/').pop()}`)
    } else {
      setDetourageExportMsg(result.error === 'Cancelled' ? null : `Erreur : ${result.error}`)
    }
    setTimeout(() => setDetourageExportMsg(null), 5000)
  }

  // ---------- Local adjustments ----------
  const handleAddRadial = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id, 'radial') as LocalAdjustment
    onLocalsChanged([...localAdjs, adj])
    onSelectLocal(adj.id)
  }

  const handleAddLasso = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id, 'lasso') as LocalAdjustment
    onLocalsChanged([...localAdjs, adj])
    onSelectLocal(adj.id)
  }

  const handleAddColor = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id, 'color') as LocalAdjustment
    onLocalsChanged([...localAdjs, adj])
    onSelectLocal(adj.id)
  }

  const handleAddClone = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id, 'clone') as LocalAdjustment
    onLocalsChanged([...localAdjs, adj])
    onSelectLocal(adj.id)
  }

  const handleAddDetourage = async (): Promise<void> => {
    const adj = await window.api.createLocalAdj(photo.id, 'detourage') as LocalAdjustment
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
    (id: number, key: LocalNumericKey, value: number) => {
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

  const updateCloneOffset = useCallback((id: number, field: 'dx' | 'dy', value: number) => {
    const updated = localAdjs.map(a => {
      if (a.id !== id) return a
      let current = { dx: 0, dy: 0 }
      try { current = JSON.parse(a.points_json ?? '{}') as { dx: number; dy: number } } catch { /**/ }
      return { ...a, points_json: JSON.stringify({ ...current, [field]: value }) }
    })
    onLocalsChanged(updated)
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current)
    localSaveTimer.current = setTimeout(async () => {
      const adj = updated.find(a => a.id === id)
      if (adj) {
        await window.api.updateLocalAdj(adj)
        onEditsChanged()
      }
    }, 400)
  }, [localAdjs, onLocalsChanged, onEditsChanged])

  const updateLocalColor = useCallback((id: number, hex: string) => {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
    if (!m) return
    const value = m[1]
    const r = parseInt(value.slice(0, 2), 16)
    const g = parseInt(value.slice(2, 4), 16)
    const b = parseInt(value.slice(4, 6), 16)

    const updated = localAdjs.map(a => a.id === id ? { ...a, target_r: r, target_g: g, target_b: b } : a)
    onLocalsChanged(updated)
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current)
    localSaveTimer.current = setTimeout(async () => {
      const adj = updated.find(a => a.id === id)
      if (adj) {
        await window.api.updateLocalAdj(adj)
        onEditsChanged()
      }
    }, 400)
  }, [localAdjs, onEditsChanged, onLocalsChanged])

  const selectedAdj = localAdjs.find(a => a.id === selectedLocalId) ?? null

  return (
    <div className={styles.panel}>
      <div className={styles.tabs}>
        <button
          className={styles.tabBtn + (activeTab === 'global' ? ' ' + styles.tabBtnActive : '')}
          onClick={() => setActiveTab('global')}
        >
          Développement
        </button>
        <button
          className={styles.tabBtn + (activeTab === 'local' ? ' ' + styles.tabBtnActive : '')}
          onClick={() => setActiveTab('local')}
        >
          Filtres locaux
        </button>
      </div>

      {activeTab === 'global' && (
        <>
          <div className={styles.group}>
            <div className={styles.groupTitle}>Lumière</div>
            <Slider
              label="Exposition"
              value={Math.round(edits.exposure * 10)}
              displayValue={Math.round(edits.exposure * 10) / 10}
              min={-50}
              max={50}
              onChange={(v) => updateEdit('exposure', v / 10)}
            />
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

          <div className={styles.group}>
            <div className={styles.groupTitle}>Géométrie</div>
            <Slider
              label="Inclinaison"
              value={Math.round(edits.rotation * 10)}
              displayValue={Math.round(edits.rotation * 10) / 10}
              min={-450}
              max={450}
              onChange={(v) => updateEdit('rotation', v / 10)}
            />
          </div>

          <div className={styles.actions}>
            <button className={styles.resetBtn} onClick={handleReset}>
              Réinitialiser
            </button>
          </div>

          <div className={styles.exportSection}>
            <div className={styles.groupTitle}>Exporter</div>
            <div className={styles.exportBtns}>
              <button className={styles.exportBtn} onClick={() => handleExport('jpeg')} disabled={exporting}>JPEG</button>
              <button className={styles.exportBtn} onClick={() => handleExport('png')} disabled={exporting}>PNG</button>
            </div>
            {exportMsg && <div className={styles.exportMsg}>{exportMsg}</div>}
          </div>
        </>
      )}

      {activeTab === 'local' && (
        <>
          <div className={styles.group}>
            <div className={styles.localHeader}>
              <div className={styles.groupTitle}>Filtres locaux</div>
              <div>
                <button className={styles.addLocalBtn} onClick={handleAddRadial} title="Ajouter un filtre radial">+R</button>
                <button className={styles.addLocalBtn} onClick={handleAddLasso} title="Ajouter un filtre lasso">+L</button>
                <button className={styles.addLocalBtn} onClick={handleAddColor} title="Ajouter un filtre couleur">+C</button>
                <button className={styles.addLocalBtn} onClick={handleAddClone} title="Ajouter un tampon clonage">+T</button>
                <button className={styles.addLocalBtn} onClick={handleAddDetourage} title="Ajouter un détourage">+D</button>
              </div>
            </div>
            {localAdjs.map((adj, i) => (
              <div
                key={adj.id}
                className={styles.localItem + (adj.id === selectedLocalId ? ' ' + styles.localItemActive : '')}
                onClick={() => onSelectLocal(adj.id === selectedLocalId ? null : adj.id)}
              >
                <span className={styles.localIcon}>
                  {adj.kind === 'lasso'
                    ? '⬠'
                    : adj.kind === 'color'
                    ? (colorPickLocalId === adj.id ? '🧪' : '◉')
                    : adj.kind === 'clone'
                    ? '⊕'
                    : adj.kind === 'detourage'
                    ? '✦'
                    : '◎'}
                </span>
                <span className={styles.localName}>
                  {adj.kind === 'lasso' ? 'Filtre lasso' : adj.kind === 'color' ? 'Filtre couleur' : adj.kind === 'clone' ? 'Tampon' : adj.kind === 'detourage' ? 'Détourage' : 'Filtre radial'} {i + 1}
                </span>
                <button
                  className={styles.localDelete}
                  onClick={(e) => { e.stopPropagation(); handleDeleteLocal(adj.id) }}
                  title="Supprimer"
                >✕</button>
              </div>
            ))}
          </div>

          {selectedAdj && (
            <div className={styles.localSliders}>
              {selectedAdj.kind === 'detourage' && (
                <>
                  <div className={styles.group}>
                    <div className={styles.groupTitle}>Sélection du fond</div>
                    {!selectedAdj.points_json && !detouragePickMode && (
                      <p className={styles.detourageInfo}>
                        Cliquez sur le fond pour sélectionner la zone à reconstruire.
                      </p>
                    )}
                    {detouragePickMode ? (
                      <button
                        className={styles.detouragePickBtn + ' ' + styles.detouragePickBtnActive}
                        onClick={onStopDetouragePick}
                      >
                        ◎ En attente de clic… (Annuler)
                      </button>
                    ) : (
                      <button className={styles.detouragePickBtn} onClick={onStartDetouragePick}>
                        {selectedAdj.points_json ? '↺ Nouvelle sélection' : '⊕ Activer la sélection'}
                      </button>
                    )}
                  </div>

                  {selectedAdj.points_json && (
                    <div className={styles.group}>
                      <div className={styles.groupTitle}>Réglage</div>
                      <Slider
                        label="Tolérance"
                        value={selectedAdj.color_tolerance}
                        min={1}
                        max={150}
                        onChange={(v) => updateLocalEdit(selectedAdj.id, 'color_tolerance', v)}
                      />
                      <button className={styles.detouragePickBtn} onClick={onToggleDetourageMask}>
                        {detourageShowMask ? '✦ Voir le résultat' : '◉ Voir la sélection'}
                      </button>
                    </div>
                  )}

                  {selectedAdj.points_json && (
                    <div className={styles.exportSection}>
                      <div className={styles.groupTitle}>Exporter (détourage)</div>
                      <div className={styles.exportBtns}>
                        <button
                          className={styles.exportBtn}
                          onClick={() => handleDetourageExport('transparent')}
                          disabled={detourageExporting}
                        >
                          PNG transparent
                        </button>
                        <button
                          className={styles.exportBtn}
                          onClick={() => handleDetourageExport('white')}
                          disabled={detourageExporting}
                        >
                          Fond blanc
                        </button>
                      </div>
                      {detourageExportMsg && <div className={styles.exportMsg}>{detourageExportMsg}</div>}
                    </div>
                  )}
                </>
              )}

              {selectedAdj.kind === 'clone' && (() => {
                let dx = 0, dy = 0
                try { const o = JSON.parse(selectedAdj.points_json ?? '{}') as { dx?: number; dy?: number }; dx = Number(o.dx ?? 0); dy = Number(o.dy ?? 0) } catch { /**/ }
                return (
                  <div className={styles.group}>
                    <div className={styles.groupTitle}>Source (décalage)</div>
                    <Slider
                      label="Décalage X"
                      value={Math.round(dx * 100)}
                      displayValue={Math.round(dx * 100)}
                      min={-50}
                      max={50}
                      onChange={(v) => updateCloneOffset(selectedAdj.id, 'dx', v / 100)}
                    />
                    <Slider
                      label="Décalage Y"
                      value={Math.round(dy * 100)}
                      displayValue={Math.round(dy * 100)}
                      min={-50}
                      max={50}
                      onChange={(v) => updateCloneOffset(selectedAdj.id, 'dy', v / 100)}
                    />
                    <div className={styles.groupTitle} style={{ marginTop: 8 }}>Pinceau</div>
                    <Slider label="Rayon" value={Math.round(selectedAdj.rx * 100)} min={1} max={50} onChange={(v) => { const updated = localAdjs.map(a => a.id === selectedAdj.id ? { ...a, rx: v / 100, ry: v / 100 } : a); onLocalsChanged(updated); if (localSaveTimer.current) clearTimeout(localSaveTimer.current); localSaveTimer.current = setTimeout(async () => { const a = updated.find(x => x.id === selectedAdj.id); if (a) { await window.api.updateLocalAdj(a); onEditsChanged() } }, 400) }} />
                    <Slider label="Adoucissement" value={Math.round(selectedAdj.feather * 100)} min={0} max={100} onChange={(v) => updateLocalShape(selectedAdj.id, 'feather', v / 100)} />
                  </div>
                )
              })()}

              {selectedAdj.kind !== 'color' && selectedAdj.kind !== 'clone' && selectedAdj.kind !== 'detourage' && (
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
              )}

              {selectedAdj.kind === 'color' && (
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Sélection couleur</div>
                  <div className={styles.sliderRow}>
                    <div className={styles.sliderHeader}>
                      <span className={styles.sliderLabel}>Couleur cible</span>
                      <span className={styles.sliderValue}>#{toHexByte(selectedAdj.target_r)}{toHexByte(selectedAdj.target_g)}{toHexByte(selectedAdj.target_b)}</span>
                    </div>
                    <input
                      type="color"
                      value={`#${toHexByte(selectedAdj.target_r)}${toHexByte(selectedAdj.target_g)}${toHexByte(selectedAdj.target_b)}`}
                      onChange={(e) => updateLocalColor(selectedAdj.id, e.target.value)}
                    />
                  </div>
                  <div className={styles.sliderRow}>
                    <button
                      className={styles.pickBtn + (colorPickLocalId === selectedAdj.id ? ' ' + styles.pickBtnActive : '')}
                      onClick={() => onStartColorPick(colorPickLocalId === selectedAdj.id ? null : selectedAdj.id)}
                    >
                      <span className={styles.pickBtnInner}>
                        <span className={styles.pickIconText} aria-hidden="true">
                          {colorPickLocalId === selectedAdj.id ? '🧪' : '◉'}
                        </span>
                        <span>{colorPickLocalId === selectedAdj.id ? 'Pipette active' : 'Prelever sur image'}</span>
                      </span>
                    </button>
                  </div>
                  <Slider
                    label="Tolérance"
                    value={selectedAdj.color_tolerance}
                    min={1}
                    max={255}
                    onChange={(v) => updateLocalEdit(selectedAdj.id, 'color_tolerance', v)}
                  />
                  <div className={styles.sliderRow}>
                    <label className={styles.invertToggle}>
                      <input type="checkbox" checked={selectedAdj.invert === 1} onChange={(e) => updateLocalShape(selectedAdj.id, 'invert', e.target.checked ? 1 : 0)} />
                      <span>Inverser (sélection opposée)</span>
                    </label>
                  </div>
                </div>
              )}
              {selectedAdj.kind !== 'clone' && selectedAdj.kind !== 'detourage' && (<>
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Lumière locale</div>
                  <Slider
                    label="Exposition"
                    value={Math.round(selectedAdj.exposure * 10)}
                    displayValue={Math.round(selectedAdj.exposure * 10) / 10}
                    min={-50}
                    max={50}
                    onChange={(v) => updateLocalEdit(selectedAdj.id, 'exposure', v / 10)}
                  />
                  <Slider label="Contraste" value={selectedAdj.contrast} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'contrast', v)} />
                  <Slider label="Hautes lumières" value={selectedAdj.highlights} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'highlights', v)} />
                  <Slider label="Ombres" value={selectedAdj.shadows} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'shadows', v)} />
                </div>
                <div className={styles.group}>
                  <div className={styles.groupTitle}>Couleur locale</div>
                  <Slider label="Saturation" value={selectedAdj.saturation} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'saturation', v)} />
                  <Slider label="Température" value={selectedAdj.temperature} min={-100} max={100} onChange={(v) => updateLocalEdit(selectedAdj.id, 'temperature', v)} />
                </div>
              </>)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
