import { ipcMain, dialog } from 'electron'
import { readdirSync, statSync, existsSync } from 'fs'
import { join, basename, dirname } from 'path'
import exifr from 'exifr'
import { stmts } from './db'
import { isSupported, generateThumbnail, applyEdits, DEFAULT_EDITS, EditParams } from './imageProcessor'
import type { SaveDialogOptions } from 'electron'

export function registerIpcHandlers(): void {
  // ---------- Folder ----------
  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('catalog:importFolder', async (_, folderPath: string) => {
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

      // Generate thumbnail
      let thumbnail: Buffer | null = null
      try {
        thumbnail = await generateThumbnail(filePath)
      } catch {
        // skip thumbnail on failure
      }

      // Parse EXIF
      let exif: Record<string, unknown> = {}
      try {
        exif = (await exifr.parse(filePath, {
          pick: ['Make', 'Model', 'DateTimeOriginal', 'ISO', 'FNumber', 'ExposureTime', 'FocalLength'],
        })) ?? {}
      } catch {
        // ignore EXIF errors
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

      if (info.lastInsertRowid) {
        results.push(Number(info.lastInsertRowid))
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
  ipcMain.handle('image:getPreview', async (_, photoId: number, width: number) => {
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
        }
      : DEFAULT_EDITS

    try {
      const buffer = await applyEdits(String(photo.file_path), edits, { width })
      return `data:image/jpeg;base64,${buffer.toString('base64')}`
    } catch {
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
    }
  })

  ipcMain.handle('edits:save', (_, photoId: number, edits: EditParams) => {
    stmts.upsertEdits.run({ photo_id: photoId, ...edits })
    return true
  })

  ipcMain.handle('edits:reset', (_, photoId: number) => {
    stmts.upsertEdits.run({ photo_id: photoId, ...DEFAULT_EDITS })
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
      const buffer = await applyEdits(String(photo.file_path), edits, { quality: exportOptions.quality })
      writeFileSync(result.filePath, buffer)
      return { success: true, path: result.filePath }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}
