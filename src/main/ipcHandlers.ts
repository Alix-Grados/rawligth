import { ipcMain, dialog } from 'electron'
import { readdirSync, statSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import exifr from 'exifr'
import { stmts } from './db'
import { isSupported, generateThumbnail, applyEditsWithLocals, DEFAULT_EDITS, EditParams, LocalAdjustmentData } from './imageProcessor'
import { persistSidecarForPhoto, restoreSidecarForPhoto } from './sidecar'
import type { SaveDialogOptions } from 'electron'

export function registerIpcHandlers(): void {
  // ---------- Folder ----------
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('catalog:importFolder', async (event, folderPath: string) => {
    if (!existsSync(folderPath)) return []

    let entries: string[]
    try {
      entries = readdirSync(folderPath)
    } catch {
      return []
    }

    const results: number[] = []

    for (const entry of entries) {
      const filePath = join(folderPath, entry)
      if (!isSupported(filePath)) continue

      let stat: ReturnType<typeof statSync>
      try {
        stat = statSync(filePath)
      } catch {
        continue
      }
      if (!stat.isFile()) continue

      // Check existing record to skip redundant work
      const cached = stmts.getPhotoByPath.get(filePath) as Record<string, unknown> | undefined

      // Generate thumbnail only if not already stored
      let thumbnail: Buffer | null = null
      if (!cached?.thumbnail) {
        try {
          thumbnail = await generateThumbnail(filePath)
        } catch (err) {
          console.error('[rawlight] generateThumbnail failed for', filePath, err)
        }
      }

      // Parse EXIF only for new photos
      let exif: Record<string, unknown> = {}
      if (!cached) {
        try {
          exif = (await exifr.parse(filePath, {
            pick: ['Make', 'Model', 'DateTimeOriginal', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength'],
          })) ?? {}
        } catch {
          // ignore EXIF errors
        }
      }

      const info = stmts.insertPhoto.run({
        file_path: filePath,
        folder_path: folderPath,
        filename: basename(filePath),
        width: null,
        height: null,
        size: stat.size,
        date_taken: exif.DateTimeOriginal ? String(exif.DateTimeOriginal) : null,
        camera_make: exif.Make ?? null,
        camera_model: exif.Model ?? null,
        iso: exif.ISO ?? null,
        aperture: exif.FNumber ?? null,
        shutter_speed: exif.ExposureTime ? `1/${Math.round(1 / Number(exif.ExposureTime))}` : null,
        focal_length: exif.FocalLength ?? null,
        thumbnail: thumbnail,
      })

      let photoId: number | null = null
      if (info.changes > 0 && info.lastInsertRowid) {
        photoId = Number(info.lastInsertRowid)
        restoreSidecarForPhoto(photoId, filePath)
        results.push(photoId)
      } else if (cached?.id) {
        photoId = Number(cached.id)
        if (!cached.thumbnail && thumbnail) {
          stmts.updatePhotoThumbnail.run(thumbnail, photoId)
        }
        restoreSidecarForPhoto(photoId, filePath)
      }

      // Emit photo to renderer as soon as it's ready
      if (photoId !== null) {
        const photoRow = stmts.getPhotoById.get(photoId) as Record<string, unknown> | undefined
        if (photoRow) {
          const thumbBuf = photoRow.thumbnail as Buffer | null
          event.sender.send('catalog:photoReady', {
            ...photoRow,
            thumbnail: thumbBuf
              ? `data:image/jpeg;base64,${Buffer.from(thumbBuf).toString('base64')}`
              : null
          })
        }
      }
    }

    return results
  })

  ipcMain.handle('catalog:getPhotosByFolder', (_, folderPath: string) => {
    const rows = stmts.getPhotosByFolder.all(folderPath) as Record<string, unknown>[]
    return rows.map((row) => ({
      ...row,
      thumbnail: row.thumbnail
        ? `data:image/jpeg;base64,${Buffer.from(row.thumbnail as Buffer).toString('base64')}`
        : null,
    }))
  })

  // ---------- Preview ----------
  ipcMain.handle('image:getPreview', async (_, photoId: number, width?: number) => {
    const photo = stmts.getPhotoById.get(photoId) as Record<string, unknown> | undefined
    if (!photo) return null

    const editsRow = stmts.getEditsByPhotoId.get(photoId) as Record<string, unknown> | undefined
    const edits: EditParams = editsRow
      ? {
          exposure: Number(editsRow.exposure),
          contrast: Number(editsRow.contrast),
          highlights: Number(editsRow.highlights),
          shadows: Number(editsRow.shadows),
          whites: Number(editsRow.whites),
          blacks: Number(editsRow.blacks),
          temperature: Number(editsRow.temperature),
          tint: Number(editsRow.tint),
          saturation: Number(editsRow.saturation),
          vibrance: Number(editsRow.vibrance),
          sharpness: Number(editsRow.sharpness),
          noise_reduction: Number(editsRow.noise_reduction),
          rotation: Number(editsRow.rotation),
        }
      : DEFAULT_EDITS

    try {
      const localAdjs = stmts.getLocalsByPhotoId.all(photoId) as LocalAdjustmentData[]
      const resolvedWidth = Number.isFinite(width) && Number(width) > 0 ? Math.round(Number(width)) : undefined
      const buffer = await applyEditsWithLocals(String(photo.file_path), edits, localAdjs, { width: resolvedWidth })
      return `data:image/jpeg;base64,${buffer.toString('base64')}`
    } catch (err) {
      console.error('[rawlight] getPreview failed for photo', photoId, err)
      return null
    }
  })

  // ---------- Edits ----------
  ipcMain.handle('edits:get', (_, photoId: number) => {
    const row = stmts.getEditsByPhotoId.get(photoId) as Record<string, unknown> | undefined
    if (!row) return DEFAULT_EDITS
    return {
      exposure: Number(row.exposure),
      contrast: Number(row.contrast),
      highlights: Number(row.highlights),
      shadows: Number(row.shadows),
      whites: Number(row.whites),
      blacks: Number(row.blacks),
      temperature: Number(row.temperature),
      tint: Number(row.tint),
      saturation: Number(row.saturation),
      vibrance: Number(row.vibrance),
      sharpness: Number(row.sharpness),
      noise_reduction: Number(row.noise_reduction),
      rotation: Number(row.rotation),
    }
  })

  ipcMain.handle('edits:save', (_, photoId: number, edits: EditParams) => {
    stmts.upsertEdits.run({ photo_id: photoId, ...edits })
    persistSidecarForPhoto(photoId)
    return true
  })

  ipcMain.handle('edits:reset', (_, photoId: number) => {
    stmts.upsertEdits.run({ photo_id: photoId, ...DEFAULT_EDITS })
    persistSidecarForPhoto(photoId)
    return DEFAULT_EDITS
  })

  // ---------- Export ----------
  ipcMain.handle('image:export', async (_, photoId: number, exportOptions: { format: 'jpeg' | 'png'; quality: number }) => {
    const photo = stmts.getPhotoById.get(photoId) as Record<string, unknown> | undefined
    if (!photo) return { success: false, error: 'Photo not found' }

    const editsRow = stmts.getEditsByPhotoId.get(photoId) as Record<string, unknown> | undefined
    const edits: EditParams = editsRow
      ? {
          exposure: Number(editsRow.exposure),
          contrast: Number(editsRow.contrast),
          highlights: Number(editsRow.highlights),
          shadows: Number(editsRow.shadows),
          whites: Number(editsRow.whites),
          blacks: Number(editsRow.blacks),
          temperature: Number(editsRow.temperature),
          tint: Number(editsRow.tint),
          saturation: Number(editsRow.saturation),
          vibrance: Number(editsRow.vibrance),
          sharpness: Number(editsRow.sharpness),
          noise_reduction: Number(editsRow.noise_reduction),
          rotation: Number(editsRow.rotation),
        }
      : DEFAULT_EDITS

    const saveOptions: SaveDialogOptions = {
      defaultPath: join(
        dirname(String(photo.file_path)),
        basename(String(photo.filename), '.'+String(photo.filename).split('.').pop()) + `_edit.${exportOptions.format}`
      ),
      filters: [
        exportOptions.format === 'jpeg'
          ? { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
          : { name: 'PNG', extensions: ['png'] },
      ],
    }

    const result = await dialog.showSaveDialog(saveOptions)
    if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

    try {
      const { writeFileSync } = await import('fs')
      const localAdjs = stmts.getLocalsByPhotoId.all(photoId) as LocalAdjustmentData[]
      const buffer = await applyEditsWithLocals(String(photo.file_path), edits, localAdjs, { quality: exportOptions.quality })
      writeFileSync(result.filePath, buffer)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ---------- Local adjustments ----------
  ipcMain.handle('local:getByPhoto', (_, photoId: number) => {
    return stmts.getLocalsByPhotoId.all(photoId)
  })

  ipcMain.handle('local:create', (_, photoId: number, kind: 'radial' | 'lasso' | 'color' = 'radial') => {
    const defaultPoints = kind === 'lasso'
      ? JSON.stringify([
          { x: 0.35, y: 0.35 },
          { x: 0.65, y: 0.35 },
          { x: 0.65, y: 0.65 },
          { x: 0.35, y: 0.65 },
        ])
      : null
    const rows = stmts.insertLocal.all(photoId, kind, defaultPoints, 128, 128, 128, 28) as LocalAdjustmentData[]
    persistSidecarForPhoto(photoId)
    return rows[0]
  })

  ipcMain.handle('local:update', (_, data: LocalAdjustmentData) => {
    stmts.updateLocal.run(data)
    persistSidecarForPhoto(data.photo_id)
    return true
  })

  ipcMain.handle('local:delete', (_, id: number) => {
    const localRow = stmts.getLocalById.get(id) as Record<string, unknown> | undefined
    stmts.deleteLocal.run(id)
    if (localRow?.photo_id) {
      persistSidecarForPhoto(Number(localRow.photo_id))
    }
    return true
  })
}
