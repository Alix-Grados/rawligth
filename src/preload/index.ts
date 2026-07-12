import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  importFolder: (folderPath: string): Promise<number[]> => ipcRenderer.invoke('catalog:importFolder', folderPath),
  getPhotosByFolder: (folderPath: string): Promise<unknown[]> => ipcRenderer.invoke('catalog:getPhotosByFolder', folderPath),
  getPreview: (photoId: number, width: number): Promise<string | null> => ipcRenderer.invoke('image:getPreview', photoId, width),
  getEdits: (photoId: number): Promise<unknown> => ipcRenderer.invoke('edits:get', photoId),
  saveEdits: (photoId: number, edits: unknown): Promise<boolean> => ipcRenderer.invoke('edits:save', photoId, edits),
  resetEdits: (photoId: number): Promise<unknown> => ipcRenderer.invoke('edits:reset', photoId),
  exportImage: (photoId: number, options: { format: 'jpeg' | 'png'; quality: number }): Promise<{ success: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('image:export', photoId, options),
  // Local adjustments
  getLocalAdjs: (photoId: number): Promise<unknown[]> => ipcRenderer.invoke('local:getByPhoto', photoId),
  createLocalAdj: (photoId: number, kind: 'radial' | 'lasso' = 'radial') =>
    ipcRenderer.invoke('local:create', photoId, kind),
  updateLocalAdj: (data: unknown): Promise<boolean> => ipcRenderer.invoke('local:update', data),
  deleteLocalAdj: (id: number): Promise<boolean> => ipcRenderer.invoke('local:delete', id),
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
