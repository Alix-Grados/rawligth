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
}

export const DEFAULT_EDITS: EditParams = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0,
  whites: 0, blacks: 0, temperature: 0, tint: 0,
  saturation: 0, vibrance: 0, sharpness: 0, noise_reduction: 0,
}

/**
 * Converts a camera RAW file to a high-quality raster buffer using native tools.
 * When maxSize is provided (for thumbnails), sips outputs a smaller JPEG to avoid
 * loading a 187MB TIFF into memory.
 * - macOS: uses built-in `/usr/bin/sips`
 * - Linux/Windows: tries `dcraw` or `rawtherapee-cli`
 */
async function rawToBuffer(filePath: string, maxSize?: number): Promise<Buffer> {
  const ext = maxSize ? 'jpg' : 'tiff'
  const tmpFile = join(tmpdir(), `rawlight_${Date.now()}_${basename(filePath)}.${ext}`)

  const runCmd = (cmd: string, args: string[]): Promise<void> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 60000 }, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

  const runCmdOut = (cmd: string, args: string[]): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: 45000, encoding: 'buffer', maxBuffer: 128 * 1024 * 1024 }, (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout as Buffer)
      })
    })

  try {
    if (process.platform === 'darwin') {
      // Use absolute path — Electron's env PATH may not include /usr/bin.
      // For thumbnails: sips resizes directly, saving ~187MB of memory per photo.
      const sipsArgs = maxSize
        ? ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', String(maxSize), filePath, '--out', tmpFile]
        : ['-s', 'format', 'tiff', filePath, '--out', tmpFile]
      await runCmd('/usr/bin/sips', sipsArgs)
      if (!existsSync(tmpFile)) throw new Error(`sips did not produce output for ${filePath}`)
      return readFileSync(tmpFile)
    } else {
      // Try dcraw first: output TIFF to stdout.
      // -c: write to stdout, -T: TIFF output, -w: camera white balance
      const dcrawOut = await runCmdOut('dcraw', ['-c', '-T', '-w', '-q', '3', filePath]).catch(() => Buffer.alloc(0))
      if (dcrawOut.length > 0) {
        return dcrawOut
      }

      // Fallback: rawtherapee-cli writing TIFF on disk.
      await runCmd('rawtherapee-cli', ['-o', tmpFile, '-t', '-c', filePath])
      return readFileSync(tmpFile)
    }
  } finally {
    try { unlinkSync(tmpFile) } catch { /* ignore cleanup errors */ }
  }
}

/**
 * Returns a sharp-compatible input: Buffer for RAW files, path string for others.
 * maxSize: if set, the RAW is decoded at a lower resolution (for thumbnails).
 */
async function getSharpInput(filePath: string, maxSize?: number): Promise<Buffer | string> {
  if (isRaw(filePath)) {
    return rawToBuffer(filePath, maxSize)
  }
  return filePath
}

/**
 * Generates a JPEG thumbnail (max 300px) for the grid view.
 */
export async function generateThumbnail(filePath: string): Promise<Buffer> {
  // Pass maxSize=600: sips resizes in-process, avoiding loading 187MB TIFF for a 300px thumb
  const input = await getSharpInput(filePath, 600)
  return sharp(input, { failOn: 'none' })
    .rotate()
    .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()
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
  }

  // Force 8-bit sRGB immediately — TIFF from sips is rgb16 (ushort).
  // Without this, the blending step gets 16-bit raw data and corrupts the output.
  let pipeline = sharp(input, { failOn: 'none' }).rotate().toColorspace('srgb')

  if (options.width) {
    pipeline = pipeline.resize(options.width, undefined, { withoutEnlargement: true })
  }

  if (e.exposure !== 0) {
    const factor = Math.pow(2, e.exposure)
    pipeline = pipeline.linear(factor, 0)
  }

  const brightnessFactor = 1 + (e.whites - e.blacks) / 200
  const saturationFactor = 1 + e.saturation / 100
  const hueDegrees = e.tint * 0.5

  if (brightnessFactor !== 1 || saturationFactor !== 1 || hueDegrees !== 0) {
    pipeline = pipeline.modulate({
      brightness: Math.max(0.1, brightnessFactor),
      saturation: Math.max(0, saturationFactor),
      hue: hueDegrees,
    })
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
  const input = await getSharpInput(filePath)
  return applyEditsToPipeline(input, edits, options).png().toBuffer()
}

export interface LocalAdjustmentData {
  id: number
  photo_id: number
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
  const decoded = await getSharpInput(filePath)
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
    }

    const localBuffer = await applyEditsToPipeline(baseBuffer, localDelta, {}).png().toBuffer()
    const meta = await sharp(baseBuffer).metadata()
    const w = meta.width!
    const h = meta.height!

    const [baseRaw, localRaw] = await Promise.all([
      sharp(baseBuffer).raw().toBuffer({ resolveWithObject: true }),
      sharp(localBuffer).raw().toBuffer({ resolveWithObject: true }),
    ])

    const channels = baseRaw.info.channels
    const mask = generateRadialMask(w, h, adj)

    const outBuf = Buffer.alloc(w * h * channels)

    for (let i = 0; i < w * h; i++) {
      const alpha = mask[i] / 255
      for (let c = 0; c < channels; c++) {
        outBuf[i * channels + c] = Math.round(
          baseRaw.data[i * channels + c] * (1 - alpha) +
          localRaw.data[i * channels + c] * alpha
        )
      }
    }

    baseBuffer = await sharp(outBuf, { raw: { width: w, height: h, channels } }).png().toBuffer()
  }

  return sharp(baseBuffer).jpeg({ quality: options.quality ?? 90 }).toBuffer()
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
