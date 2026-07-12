export interface EditParams {
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

export interface Photo {
  id: number
  file_path: string
  folder_path: string
  filename: string
  width: number | null
  height: number | null
  size: number
  date_taken: string | null
  camera_make: string | null
  camera_model: string | null
  iso: number | null
  aperture: number | null
  shutter_speed: string | null
  focal_length: number | null
  thumbnail: string | null
  added_at: string
}

export const DEFAULT_EDITS: EditParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  vibrance: 0,
  sharpness: 0,
  noise_reduction: 0,
}
