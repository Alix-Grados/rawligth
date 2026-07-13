import sharp, { Sharp } from 'sharp'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { extname, basename, join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'

export const RAW_EXTENSIONS = new Set([
  '.raw', '.cr2', '.cr3', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.dng', '.orf', '.rw2', '.pef', '.ptx', '.raf', '.3fr', '.fff',
  '.iiq', '.rwl', '.mrw', '.x3f',
])

export const SUPPORTED_EXTENSIONS = new Set([
  ...RAW_EXTENSIONS,
  '.jpg', '.jpeg', '.png', '.tiff', '.tif', '.webp', '.heic', '.heif',
])

export function isSupported(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export function isRaw(filePath: string): boolean {
  return RAW_EXTENSIONS.has(extname(filePath).toLowerCase())
}

export interface EditParams {
  exposure: number       // -5 to +5 EV
  contrast: number       // -100 to +100
  highlights: number     // -100 to +100
  shadows: number        // -100 to +100
  whites: number         // -100 to +100
  blacks: number         // -100 to +100
  temperature: number    // -100 to +100 (relative shift)
  tint: number           // -100 to +100
  saturation: number     // -100 to +100
  vibrance: number       // -100 to +100
  sharpness: number      // 0 to 100
  noise_reduction: number // 0 to 100
  rotation: number       // -45 to +45 degrees
}

export const DEFAULT_EDITS: EditParams = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, temperature: 0, tint: 0,
  saturation: 0, vibrance: 0, sharpness: 0, noise_reduction: 0,
  rotation: 0,
}

/**
 * Converts a camera RAW file to a high-quality raster buffer using native tools.
 * When maxSize is provided (for thumbnails), sips outputs a smaller JPEG to avoid
 * loading a 187MB TIFF into memory.
 * - macOS: uses built-in `/usr/bin/sips`
 * - Linux/Windows: tries `dcraw` or `rawtherapee-cli`
 */
// dcraw may live in Homebrew paths that Electron's sandboxed env doesn't see.
function findDcraw(): string {
  const { execFileSync } = require('child_process') as typeof import('child_process')
  for (const candidate of [
    '/opt/homebrew/bin/dcraw',
    '/usr/local/bin/dcraw',
    'dcraw',
  ]) {
    try { execFileSync(candidate, ['--help'], { timeout: 2000, stdio: 'ignore' }); return candidate } catch { /* next */ }
  }
  return 'dcraw'
}
const DCRAW_BIN = findDcraw()

async function rawToBuffer(filePath: string): Promise<Buffer> {
  const tmpFile = join(tmpdir(), `rawlight_${Date.now()}_${basename(filePath)}.tiff`)
  const ext = extname(filePath).toLowerCase()

  const runCmdOut = (cmd: string, args: string[]): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 60000, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout as Buffer)
      })
    })

  const runCmd = (cmd: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 60000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

  try {
    // ── Priority 1: dcraw — neutral AHD decode, 16-bit, no hidden processing ──
    // dcraw is preferred over sips: sips applies Apple's automatic noise reduction and
    // tone adjustments that soften the image. dcraw gives a neutral base for our own edits.
    // Install: brew install dcraw
    console.log(`[rawlight] Attempting dcraw decode for ${ext} file: ${filePath}`)
    const dcrawArgs = ['-c', '-T', '-w', '-q', '3', '-H', '2', '-o', '1', '-6', filePath]
    try {
      const dcrawOut = await runCmdOut(DCRAW_BIN, dcrawArgs)
      if (dcrawOut.length > 10000) {
        console.log(`[rawlight] ✓ dcraw decoded RAW to 16-bit TIFF (${dcrawOut.length} bytes): ${filePath}`)
        return dcrawOut
      } else {
        console.log(`[rawlight] dcraw output too small (${dcrawOut.length} bytes), skipping`)
      }
    } catch (err) {
      console.log(`[rawlight] dcraw failed: ${String(err).slice(0, 100)}`)
    }

    // ── Fallback: sips (macOS only) ──
    // sips uses Apple's Core Image RAW, which applies automatic noise reduction.
    // Used only when dcraw is not installed.
    if (process.platform === 'darwin') {
      console.log(`[rawlight] Attempting sips decode for ${ext} file: ${filePath}`)
      try {
        await runCmd('/usr/bin/sips', ['-s', 'format', 'tiff', filePath, '--out', tmpFile])
        if (existsSync(tmpFile)) {
          const data = readFileSync(tmpFile)
          if (data.length > 10000) {
            console.log(`[rawlight] ✓ sips decoded RAW to TIFF (${data.length} bytes): ${filePath}`)
            return data
          }
        }
      } catch (err) {
        console.log(`[rawlight] sips failed: ${String(err).slice(0, 100)}`)
      }
    }

    // ── Fallback: rawtherapee-cli (Linux/Windows) ──
    if (process.platform !== 'darwin') {
      console.log(`[rawlight] Attempting rawtherapee-cli decode for ${ext} file: ${filePath}`)
      try {
        await runCmd('rawtherapee-cli', ['-o', tmpFile, '-t', '-c', filePath])
        if (existsSync(tmpFile)) {
          const data = readFileSync(tmpFile)
          if (data.length > 10000) {
            console.log(`[rawlight] ✓ rawtherapee-cli decoded RAW to TIFF (${data.length} bytes): ${filePath}`)
            return data
          }
        }
      } catch (err) {
        console.log(`[rawlight] rawtherapee-cli failed: ${String(err).slice(0, 100)}`)
      }
    }

    throw new Error(
      `No RAW decoder available for ${filePath} (${ext}). ` +
      `Install dcraw for best quality: macOS: brew install dcraw, Linux: apt install dcraw`
    )
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
  }
}



async function getSharpInput(filePath: string): Promise<Buffer | string> {
  if (isRaw(filePath)) {
    return rawToBuffer(filePath)
  }
  return filePath
}

/**
 * Generates a JPEG thumbnail (max 300px) for the grid view.
 * For RAW files, decodes via native tools (sips/dcraw/rawtherapee) → TIFF → resized JPEG.
 * No JPEG fallback — ensures quality.
 */
export async function generateThumbnail(filePath: string): Promise<Buffer> {
  const renderThumb = (input: Buffer | string): Promise<Buffer> =>
    sharp(input, { failOn: 'none' })
      .rotate()
      .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 75 })
      .toBuffer()

  try {
    const input = await getSharpInput(filePath)
    console.log(`[rawlight] Rendering thumbnail (300px max) for ${filePath}`)
    return await renderThumb(input)
  } catch (err) {
    console.error(`[rawlight] Thumbnail generation failed for ${filePath}:`, err)
    throw new Error(`Cannot generate thumbnail for ${filePath}: ${String(err).slice(0, 80)}`)
  }
}

/**
 * Applies edit params to an already-decoded lossless buffer (PNG or path).
 * Internal helper — accepts a pre-decoded buffer so RAW files are only decoded once.
 */
function applyEditsToPipeline(
  input: Buffer | string,
  edits: EditParams,
  options: { width?: number } = {}
): Sharp {
  const toNum = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  const e: EditParams = {
    exposure: toNum(edits.exposure),
    contrast: toNum(edits.contrast),
    highlights: toNum(edits.highlights),
    shadows: toNum(edits.shadows),
    whites: toNum(edits.whites),
    blacks: toNum(edits.blacks),
    temperature: toNum(edits.temperature),
    tint: toNum(edits.tint),
    saturation: toNum(edits.saturation),
    vibrance: toNum(edits.vibrance),
    sharpness: toNum(edits.sharpness),
    noise_reduction: toNum(edits.noise_reduction),
    rotation: toNum(edits.rotation),
  }

  // Keep native bit depth (16-bit for TIFF from sips/dcraw) throughout the edit pipeline.
  // toColorspace('srgb') would downgrade 16-bit to 8-bit — we defer that to the output step.
  // Note: EXIF auto-rotation (.rotate() with no args) is NOT done here — it is applied by the
  // caller as a separate pre-processing step, because chaining two .rotate() calls in sharp
  // causes the second to override the first's useExifOrientation flag (they do not compose).
  let pipeline = sharp(input, { failOn: 'none' })

  if (e.rotation !== 0) {
    pipeline = pipeline.rotate(e.rotation, { background: { r: 0, g: 0, b: 0 } })
  }

  if (options.width) {
    pipeline = pipeline.resize(options.width, undefined, { withoutEnlargement: true })
  }

  // Exposure and whites/blacks are applied through brightness modulation.
  // This is more stable across RAW->TIFF->PNG pipelines than linear() scaling.
  const exposureFactor = Math.pow(2, e.exposure)
  const toneBrightness = 1 + (e.whites - e.blacks) / 200
  const brightnessFactor = exposureFactor * toneBrightness
  const saturationFactor = 1 + e.saturation / 100
  const hueShift = Math.round(e.tint * 0.5)
  const hueDegrees = ((hueShift % 360) + 360) % 360

  if (brightnessFactor !== 1 || saturationFactor !== 1 || hueDegrees !== 0) {
    pipeline = pipeline.modulate({
      brightness: Math.max(0, brightnessFactor),
      saturation: Math.max(0, saturationFactor),
      hue: hueDegrees,
    })
  }

  // Temperature: warm (+) boosts R and reduces B, cool (-) does the opposite.
  // Uses a recomb matrix — works at any bit depth and before contrast/tone ops.
  if (e.temperature !== 0) {
    const f = Math.max(-0.25, Math.min(0.25, e.temperature / 100 * 0.25))
    pipeline = pipeline.recomb([
      [1 + f, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - f],
    ])
  }

  if (e.contrast !== 0) {
    const slope = 1 + e.contrast / 100
    const intercept = 128 * (1 - slope) / 255
    pipeline = pipeline.linear(slope, intercept)
  }

  if (e.highlights !== 0) {
    if (e.highlights > 0) {
      pipeline = pipeline.linear(1 + e.highlights / 500, 0)
    } else {
      pipeline = pipeline.gamma(Math.min(3, 1 + Math.abs(e.highlights) / 100))
    }
  }

  if (e.shadows !== 0) {
    if (e.shadows > 0) {
      pipeline = pipeline.linear(1, e.shadows / 1000)
    } else {
      pipeline = pipeline.gamma(Math.min(3, 1 + Math.abs(e.shadows) / 100))
    }
  }

  if (e.sharpness > 0) {
    const sigma = 0.5 + (e.sharpness / 100) * 1.5
    pipeline = pipeline.sharpen({ sigma })
  }

  if (e.noise_reduction > 0) {
    pipeline = pipeline.blur(Math.max(0.3, (e.noise_reduction / 100) * 1.5))
  }

  return pipeline
}

/**
 * Applies edit params to an image and returns a lossless PNG buffer.
 */
export async function applyEdits(
  filePath: string,
  edits: EditParams,
  options: { width?: number; quality?: number } = {}
): Promise<Buffer> {
  const rawInput = await getSharpInput(filePath)
  const input = isRaw(filePath)
    ? (rawInput as Buffer)
    : await sharp(rawInput as string, { failOn: 'none' }).rotate().png().toBuffer()
  return applyEditsToPipeline(input, edits, options).png().toBuffer()
}

export interface LocalAdjustmentData {
  id: number
  photo_id: number
  kind: 'radial' | 'lasso' | 'color'
  points_json: string | null
  target_r: number
  target_g: number
  target_b: number
  color_tolerance: number
  cx: number
  cy: number
  rx: number
  ry: number
  feather: number
  invert: number // 0 | 1 from SQLite
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  temperature: number
  tint: number
  saturation: number
  vibrance: number
  sharpness: number
  noise_reduction: number
}

interface LassoPoint {
  x: number
  y: number
}

function parseLassoPoints(pointsJson: string | null): LassoPoint[] {
  if (!pointsJson) return []
  try {
    const parsed = JSON.parse(pointsJson) as Array<{ x: unknown; y: unknown }>
    return parsed
      .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  } catch {
    return []
  }
}

function pointInPolygon(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x
    const yi = poly[i].y
    const xj = poly[j].x
    const yj = poly[j].y
    const intersects = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

/**
 * Generates a grayscale radial gradient mask (Buffer of width*height bytes, 0–255).
 * Values represent how strongly the local adjustments apply at each pixel.
 */
function generateRadialMask(width: number, height: number, adj: LocalAdjustmentData): Buffer {
  const buf = Buffer.alloc(width * height)
  const centerX = adj.cx * width
  const centerY = adj.cy * height
  const radiusX = Math.max(1, adj.rx * width)
  const radiusY = Math.max(1, adj.ry * height)
  const feather = Math.max(0.001, adj.feather)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = (x - centerX) / radiusX
      const dy = (y - centerY) / radiusY
      const dist = Math.sqrt(dx * dx + dy * dy)

      let alpha: number
      const innerEdge = 1 - feather
      if (dist <= innerEdge) {
        alpha = 255
      } else if (dist >= 1) {
        alpha = 0
      } else {
        const t = (dist - innerEdge) / feather
        alpha = Math.round(255 * 0.5 * (1 + Math.cos(t * Math.PI)))
      }

      buf[y * width + x] = adj.invert ? 255 - alpha : alpha
    }
  }
  return buf
}

function generateLassoMask(width: number, height: number, adj: LocalAdjustmentData): Buffer {
  const buf = Buffer.alloc(width * height)
  const points = parseLassoPoints(adj.points_json)
  if (points.length < 3) return buf

  const poly = points.map((p) => ({ x: p.x * width, y: p.y * height }))
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const inside = pointInPolygon(x + 0.5, y + 0.5, poly)
      const alpha = inside ? 255 : 0
      buf[y * width + x] = adj.invert ? 255 - alpha : alpha
    }
  }
  return buf
}

function generateColorMask(
  width: number,
  height: number,
  adj: LocalAdjustmentData,
  source: { data: Buffer; channels: number }
): Buffer {
  const buf = Buffer.alloc(width * height)
  const tr = Math.max(0, Math.min(255, Math.round(adj.target_r)))
  const tg = Math.max(0, Math.min(255, Math.round(adj.target_g)))
  const tb = Math.max(0, Math.min(255, Math.round(adj.target_b)))
  const tol = Math.max(1, Math.min(255, Math.round(adj.color_tolerance)))
  const tolSq = tol * tol

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const p = i * source.channels
      const dr = Number(source.data[p]) - tr
      const dg = Number(source.data[p + 1]) - tg
      const db = Number(source.data[p + 2]) - tb
      const distSq = dr * dr + dg * dg + db * db
      const alpha = distSq <= tolSq ? 255 : 0
      buf[i] = adj.invert ? 255 - alpha : alpha
    }
  }

  return buf
}

function generateMask(
  width: number,
  height: number,
  adj: LocalAdjustmentData,
  source: { data: Buffer; channels: number }
): Buffer {
  if (adj.kind === 'color') {
    return generateColorMask(width, height, adj, source)
  }
  if (adj.kind === 'lasso') {
    return generateLassoMask(width, height, adj)
  }
  return generateRadialMask(width, height, adj)
}

/**
 * Applies global edits then blends local (radial) adjustments on top.
 * The RAW file is decoded ONCE and all edit pipelines share the same decoded buffer.
 * Returns a final JPEG buffer.
 */
export async function applyEditsWithLocals(
  filePath: string,
  globalEdits: EditParams,
  localAdjs: LocalAdjustmentData[],
  options: { width?: number; quality?: number } = {}
): Promise<Buffer> {
  const rawInput = await getSharpInput(filePath)
  // Apply EXIF auto-orientation as a separate pre-processing step.
  // For RAW files the decoder (dcraw/sips) already outputs correctly-oriented pixels,
  // so .rotate() on the buffer is a no-op. For standard formats (JPEG, PNG, TIFF) it
  // reads the Orientation EXIF tag and corrects the image before the edit pipeline.
  // We must NOT do this inside applyEditsToPipeline because chaining two .rotate()
  // calls in sharp does not compose — the second overrides the first.
  const decoded = isRaw(filePath)
    ? (rawInput as Buffer)
    : await sharp(rawInput as string, { failOn: 'none' }).rotate().png().toBuffer()
  const toNum = (v: unknown): number => {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }

  let baseBuffer = await applyEditsToPipeline(decoded, globalEdits, options).png().toBuffer()

  for (const adj of localAdjs) {
    // Apply only local delta on top of the already-rendered global image.
    // This is more stable for RAW workflows than recomputing (global+local) from source.
    const localDelta: EditParams = {
      exposure: toNum(adj.exposure),
      contrast: toNum(adj.contrast),
      highlights: toNum(adj.highlights),
      shadows: toNum(adj.shadows),
      whites: toNum(adj.whites),
      blacks: toNum(adj.blacks),
      temperature: toNum(adj.temperature),
      tint: toNum(adj.tint),
      saturation: toNum(adj.saturation),
      vibrance: toNum(adj.vibrance),
      sharpness: toNum(adj.sharpness),
      noise_reduction: toNum(adj.noise_reduction),
      rotation: 0,
    }

    const localBuffer = await applyEditsToPipeline(baseBuffer, localDelta, {}).png().toBuffer()
    // Convert to 8-bit sRGB before raw blending: without toColorspace('srgb'),
    // raw() on a 16-bit buffer returns the underlying bytes verbatim (not scaled to 0-255).
    const baseRaw = await sharp(baseBuffer).toColorspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const localRaw = await sharp(localBuffer).toColorspace('srgb').removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const w = baseRaw.info.width
    const h = baseRaw.info.height
    const mask = generateMask(w, h, adj, { data: baseRaw.data, channels: baseRaw.info.channels })

    const channels = 3
    const out = Buffer.alloc(w * h * channels)

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        const m = mask[i] / 255
        const bi = i * baseRaw.info.channels
        const li = i * localRaw.info.channels
        const oi = i * channels

        for (let c = 0; c < channels; c++) {
          const b = baseRaw.data[bi + c]
          const l = localRaw.data[li + c]
          out[oi + c] = Math.max(0, Math.min(255, Math.round(b * (1 - m) + l * m)))
        }
      }
    }

    baseBuffer = await sharp(out, { raw: { width: w, height: h, channels } }).png().toBuffer()
  }

  return sharp(baseBuffer).jpeg({ quality: options.quality ?? 95 }).toBuffer()
}

/**
 * Public export: applies global edits only (used where no locals needed).
 */
export async function applyEditsJpeg(
  filePath: string,
  edits: EditParams,
  options: { width?: number; quality?: number } = {}
): Promise<Buffer> {
  const png = await applyEdits(filePath, edits, options)
  return sharp(png).jpeg({ quality: options.quality ?? 90 }).toBuffer()
}
