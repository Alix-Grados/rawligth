import { ElectronAPI } from '@electron-toolkit/preload'

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

export interface LocalAdjustment {
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
  invert: number // 0 | 1
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

export interface RawlightAPI {
  openFolder(): Promise<string | null>
  importFolder(folderPath: string): Promise<number[]>
  getPhotosByFolder(folderPath: string): Promise<Photo[]>
  getPreview(photoId: number, width?: number): Promise<string | null>
  getEdits(photoId: number): Promise<EditParams>
  saveEdits(photoId: number, edits: EditParams): Promise<boolean>
  resetEdits(photoId: number): Promise<EditParams>
  exportImage(photoId: number, options: { format: 'jpeg' | 'png'; quality: number }): Promise<{ success: boolean; path?: string; error?: string }>
  getLocalAdjs(photoId: number): Promise<LocalAdjustment[]>
  createLocalAdj(photoId: number, kind?: 'radial' | 'lasso' | 'color'): Promise<LocalAdjustment>
  updateLocalAdj(data: LocalAdjustment): Promise<boolean>
  deleteLocalAdj(id: number): Promise<boolean>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RawlightAPI
  }
}
