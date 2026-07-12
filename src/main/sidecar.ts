import { existsSync, readFileSync, writeFileSync } from 'fs'
import { stmts } from './db'
import { DEFAULT_EDITS, EditParams, LocalAdjustmentData } from './imageProcessor'

function mapEdits(row: Record<string, unknown> | undefined): EditParams {
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
}

export function persistSidecarForPhoto(photoId: number): void {
  const photo = stmts.getPhotoById.get(photoId) as Record<string, unknown> | undefined
  if (!photo) return

  const editsRow = stmts.getEditsByPhotoId.get(photoId) as Record<string, unknown> | undefined
  const localRows = stmts.getLocalsByPhotoId.all(photoId) as LocalAdjustmentData[]

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    sourceFile: String(photo.file_path),
    globalEdits: mapEdits(editsRow),
    localAdjustments: localRows.map((r) => ({
      id: r.id,
      type: 'radial',
      cx: r.cx,
      cy: r.cy,
      rx: r.rx,
      ry: r.ry,
      feather: r.feather,
      invert: r.invert,
      edits: {
        exposure: r.exposure,
        contrast: r.contrast,
        highlights: r.highlights,
        shadows: r.shadows,
        whites: r.whites,
        blacks: r.blacks,
        temperature: r.temperature,
        tint: r.tint,
        saturation: r.saturation,
        vibrance: r.vibrance,
        sharpness: r.sharpness,
        noise_reduction: r.noise_reduction,
      },
    })),
  }

  writeFileSync(`${String(photo.file_path)}.rawlight.json`, JSON.stringify(payload, null, 2), 'utf-8')
}

type SidecarLocal = {
  cx: number
  cy: number
  rx: number
  ry: number
  feather: number
  invert: number
  edits?: Partial<EditParams>
}

type SidecarPayload = {
  version: number
  globalEdits?: Partial<EditParams>
  localAdjustments?: SidecarLocal[]
}

function num(v: unknown, fallback: number): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function restoreSidecarForPhoto(photoId: number, filePath: string): void {
  const sidecarPath = `${filePath}.rawlight.json`
  if (!existsSync(sidecarPath)) return

  let payload: SidecarPayload
  try {
    payload = JSON.parse(readFileSync(sidecarPath, 'utf-8')) as SidecarPayload
  } catch {
    return
  }

  const g = payload.globalEdits ?? {}
  stmts.upsertEdits.run({
    photo_id: photoId,
    exposure: num(g.exposure, 0),
    contrast: num(g.contrast, 0),
    highlights: num(g.highlights, 0),
    shadows: num(g.shadows, 0),
    whites: num(g.whites, 0),
    blacks: num(g.blacks, 0),
    temperature: num(g.temperature, 0),
    tint: num(g.tint, 0),
    saturation: num(g.saturation, 0),
    vibrance: num(g.vibrance, 0),
    sharpness: num(g.sharpness, 0),
    noise_reduction: num(g.noise_reduction, 0),
  })

  stmts.deleteLocalsByPhotoId.run(photoId)
  for (const local of payload.localAdjustments ?? []) {
    const e = local.edits ?? {}
    stmts.insertLocalFull.run({
      photo_id: photoId,
      cx: num(local.cx, 0.5),
      cy: num(local.cy, 0.5),
      rx: num(local.rx, 0.25),
      ry: num(local.ry, 0.2),
      feather: num(local.feather, 0.5),
      invert: num(local.invert, 0),
      exposure: num(e.exposure, 0),
      contrast: num(e.contrast, 0),
      highlights: num(e.highlights, 0),
      shadows: num(e.shadows, 0),
      whites: num(e.whites, 0),
      blacks: num(e.blacks, 0),
      temperature: num(e.temperature, 0),
      tint: num(e.tint, 0),
      saturation: num(e.saturation, 0),
      vibrance: num(e.vibrance, 0),
      sharpness: num(e.sharpness, 0),
      noise_reduction: num(e.noise_reduction, 0),
    })
  }
}
