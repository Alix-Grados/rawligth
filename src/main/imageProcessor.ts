import sharp from 'sharp'
import { readFileSync } from 'fs'
import { extname } from 'path'

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
 * Generates a JPEG thumbnail (max 300px) for the grid view.
 */
export async function generateThumbnail(filePath: string): Promise<Buffer> {
  const input = isRaw(filePath) ? readFileSync(filePath) : filePath
  return sharp(input, { failOn: 'none' })
    .rotate() // auto-orient from EXIF
    .resize(300, 300, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 75 })
    .toBuffer()
}

/**
 * Applies edit params to an image and returns a JPEG buffer (for preview or export).
 */
export async function applyEdits(
  filePath: string,
  edits: EditParams,
  options: { width?: number; quality?: number } = {}
): Promise<Buffer> {
  const input = isRaw(filePath) ? readFileSync(filePath) : filePath

  let pipeline = sharp(input, { failOn: 'none' }).rotate()

  if (options.width) {
    pipeline = pipeline.resize(options.width, undefined, { withoutEnlargement: true })
  }

  // Exposure: multiply by 2^EV
  if (edits.exposure !== 0) {
    const factor = Math.pow(2, edits.exposure)
    pipeline = pipeline.linear(factor, 0)
  }

  // Modulate: brightness (whites/blacks via gamma), saturation, hue (tint)
  const brightnessFactor = 1 + (edits.whites - edits.blacks) / 200
  const saturationFactor = 1 + edits.saturation / 100
  const hueDegrees = edits.tint * 0.5 // small hue shift for tint

  if (brightnessFactor !== 1 || saturationFactor !== 1 || hueDegrees !== 0) {
    pipeline = pipeline.modulate({
      brightness: Math.max(0.1, brightnessFactor),
      saturation: Math.max(0, saturationFactor),
      hue: hueDegrees,
    })
  }

  // Contrast via linear transform: out = in * slope + intercept
  if (edits.contrast !== 0) {
    const slope = 1 + edits.contrast / 100
    const intercept = 128 * (1 - slope) / 255
    pipeline = pipeline.linear(slope, intercept)
  }

  // Highlights/shadows: tone-curve approximation via gamma
  const highlightGamma = edits.highlights > 0
    ? 1 - edits.highlights / 200
    : 1 - edits.highlights / 400
  const shadowGamma = edits.shadows > 0
    ? 1 - edits.shadows / 400
    : 1 - edits.shadows / 200

  const combinedGamma = highlightGamma * shadowGamma
  if (Math.abs(combinedGamma - 1) > 0.01) {
    pipeline = pipeline.gamma(Math.max(0.1, Math.min(3, combinedGamma)))
  }

  // Sharpness
  if (edits.sharpness > 0) {
    const sigma = 0.5 + (edits.sharpness / 100) * 1.5
    pipeline = pipeline.sharpen({ sigma })
  }

  // Noise reduction via blur
  if (edits.noise_reduction > 0) {
    const blurSigma = (edits.noise_reduction / 100) * 1.5
    pipeline = pipeline.blur(Math.max(0.3, blurSigma))
  }

  return pipeline.jpeg({ quality: options.quality ?? 90 }).toBuffer()
}
