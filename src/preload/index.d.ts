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

export interface RawlightAPI {
  openFolder(): Promise<string | null>
  importFolder(folderPath: string): Promise<number[]>
  getPhotosByFolder(folderPath: string): Promise<Photo[]>
  getPreview(photoId: number, width: number): Promise<string | null>
  getEdits(photoId: number): Promise<EditParams>
  saveEdits(photoId: number, edits: EditParams): Promise<boolean>
  resetEdits(photoId: number): Promise<EditParams>
  exportImage(photoId: number, options: { format: 'jpeg' | 'png'; quality: number }): Promise<{ success: boolean; path?: string; error?: string }>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: RawlightAPI
  }
}
