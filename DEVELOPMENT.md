# rawlight - Development Guide

An Electron application for advanced photo management, editing, and RAW image processing with React and TypeScript.

**Version:** 1.0.0  
**Author:** example.com  
**License:** MIT (inferred)

---

## 📋 Project Overview

Rawlight is a desktop application built with Electron that allows users to:
- Browse and organize photos in folders
- View high-resolution image previews with zoom and pan capabilities
- Edit image metadata and EXIF information
- Apply local adjustments to images (brushed edits)
- Process RAW image formats with advanced rendering options
- Export edited images

The application uses a SQLite database for photo cataloging and supports native image processing through better-sqlite3, sharp, and libraw-wasm.

---

## 🏗️ Architecture

### Technology Stack

**Core Framework:**
- Electron 39.2.6 - Desktop application framework
- React 19.2.1 - UI framework
- TypeScript 5.9.3 - Type-safe development
- Vite 7.2.6 - Build tool
- electron-vite 5.0.0 - Electron + Vite integration

**Image Processing:**
- sharp 0.35.3 - Image resizing and processing
- better-sqlite3 12.11.1 - Database for photo metadata
- libraw-wasm 1.6.0 - RAW image format support
- exifr 7.1.3 - EXIF metadata extraction

**Development Tools:**
- ESLint - Code linting
- Prettier - Code formatting
- electron-builder 26.0.12 - Application packaging
- electron-rebuild - Native module compilation

---

## 📁 Project Structure

```
rawlight/
├── src/
│   ├── main/                      # Electron main process
│   │   ├── index.ts               # App entry point & window management
│   │   ├── db.ts                  # SQLite database schema & helpers
│   │   ├── imageProcessor.ts      # Image resizing & preview generation
│   │   ├── ipcHandlers.ts         # IPC event handlers for main-renderer communication
│   │   └── sidecar.ts             # External process management
│   │
│   ├── preload/                   # Preload scripts (sandboxed bridge)
│   │   ├── index.ts               # Preload script exposing safe APIs
│   │   └── index.d.ts             # TypeScript definitions for preload
│   │
│   └── renderer/                  # React UI (runs in Chromium)
│       ├── src/
│       │   ├── App.tsx            # Main app component & state management
│       │   ├── types.ts           # TypeScript interfaces (Photo, LocalAdjustment, etc.)
│       │   ├── main.tsx           # React DOM mount point
│       │   ├── env.d.ts           # Vite type definitions
│       │   │
│       │   ├── components/        # React components
│       │   │   ├── Sidebar.tsx    # Folder navigation & file browser
│       │   │   ├── Toolbar.tsx    # Action buttons & controls
│       │   │   ├── PhotoGrid.tsx  # Grid view of photos in current folder
│       │   │   ├── DetailView.tsx # Single photo preview with zoom/pan/adjustments
│       │   │   ├── EditPanel.tsx  # EXIF & metadata editor
│       │   │   └── Versions.tsx   # Component for version display
│       │   │
│       │   └── assets/            # Styles and static resources
│       │       ├── base.css
│       │       └── main.css
│       │
│       └── index.html             # HTML entry point
│
├── build/
│   └── entitlements.mac.plist     # macOS permissions & entitlements
│
├── resources/                     # Application resources & icons
│
├── out/                           # Build output directory (generated)
│
├── Configuration Files
│   ├── package.json               # Project metadata & dependencies
│   ├── electron.vite.config.ts    # Vite build configuration
│   ├── electron-builder.yml       # App packaging & distribution config
│   ├── tsconfig.json              # TypeScript base config
│   ├── tsconfig.node.json         # TypeScript config for node files
│   ├── tsconfig.web.json          # TypeScript config for renderer
│   ├── eslint.config.mjs          # ESLint rules
│   └── pnpm-lock.yaml             # Locked dependency versions
```

---

## 🗄️ Database Schema

Rawlight uses SQLite (better-sqlite3) to store photo metadata:

**photos table:**
- `id` - Unique identifier
- `file_path` - Full path to the image file
- `folder_path` - Parent folder path
- `filename` - Just the filename
- `width`, `height` - Image dimensions
- `size` - File size in bytes
- (Additional EXIF fields for metadata)

**local_adjustments table:**
- Stores brush-based edits (local adjustments) per photo
- Allows non-destructive editing

---

## 🎨 Key Features & Components

### DetailView Component
- Displays single photo preview with advanced rendering options
- **Scale Modes:** Fit / Fill / 100% / 200%
  - 100%/200% compute pixel-accurate multipliers from naturalWidth/clientWidth
- **Render Modes:** Fast (quick preview) / Full (progressive rendering)
  - Full mode: fast preview first, then full resolution in background
- **Preview Scaling:** Adaptive width based on viewport, zoom level, and device pixel ratio
  - Clamped to 1600px - 7680px range
  - Preview requests debounced (~140ms) to prevent re-render storms during zoom
- Supports color picking for local adjustments
- Interactive zoom and pan controls

### App State Management
- `currentFolder` - Currently selected folder
- `photos` - Photo array loaded from folder
- `selectedPhoto` - Currently displayed photo in detail view
- `viewMode` - 'grid' or 'detail' display mode
- `localAdjs` - Local adjustments (brush edits) for current photo
- `selectedLocalId` - Which local adjustment is being edited
- `colorPickLocalId` - Which adjustment's color is being picked

---

## 🚀 Available Scripts

```bash
# Development
npm run dev              # Start dev server with HMR (hot reload)
npm run start            # Run in preview mode (built app)

# Building & Packaging
npm run build            # Full TypeScript check + build for all platforms
npm run build:mac        # Build macOS app (dmg installer)
npm run build:win        # Build Windows app (exe installer)
npm run build:linux      # Build Linux app (AppImage, snap, deb)
npm run build:unpack     # Build for all platforms without packaging

# Code Quality
npm run format           # Format code with Prettier
npm run lint             # Lint code with ESLint
npm run typecheck        # Run TypeScript type checking
npm run typecheck:node   # Check main process types
npm run typecheck:web    # Check renderer types

# Maintenance
npm run postinstall      # Run after dependencies install (auto-runs)
                         # - electron-builder install-app-deps
                         # - electron-rebuild for better-sqlite3 native bindings
```

---

## 🛠️ Setup & Installation

### Prerequisites
- Node.js 18+ (or use nvm)
- pnpm (package manager)
- macOS, Windows, or Linux

### Install Dependencies

```bash
cd rawlight
pnpm install
```

**Note:** The first install will trigger `postinstall` hooks to rebuild native modules (better-sqlite3).

### Approve Build Scripts

When prompted to approve build scripts (Electron, esbuild, etc.):
```bash
pnpm approve-builds
# Select: electron, better-sqlite3
```

Alternatively, edit `.npmrc` to skip this:
```
script-shell=/bin/bash
unsafe-perm=true
```

---

## 🔧 Development Workflow

### Start Development Server

```bash
pnpm dev
```

This will:
1. Build the Electron main process
2. Build the preload scripts
3. Start a Vite dev server on `http://localhost:5173`
4. Launch the Electron app with hot reload enabled

The app window appears once both renderer and main process are ready.

### Debugging

**In VS Code:**
- Attach debugger to Electron main process (via VS Code's Electron debug configuration)
- Use browser DevTools in Electron window (Cmd+Option+I on macOS)

**File Changes:**
- Renderer changes auto-reload (HMR)
- Main process changes require manual restart (due to Electron's architecture)

---

## 🏗️ Building for Distribution

### macOS Build
```bash
pnpm build:mac
```
Creates a signed/notarized dmg installer in `out/` (if configured).

**Configuration:**
- Entitlements in `build/entitlements.mac.plist`
- Notarization: currently disabled (`notarize: false` in electron-builder.yml)
- Camera & microphone permissions requested (NSCameraUsageDescription, NSMicrophoneUsageDescription)

### Windows Build
```bash
pnpm build:win
```
Creates an NSIS installer (`.exe` setup).

### Linux Build
```bash
pnpm build:linux
```
Creates AppImage, snap, and deb packages.

---

## 🐛 Troubleshooting

### Issue: "Electron uninstall" Error at Dev Start

**Error Message:**
```
Error: Electron uninstall
    at getElectronPath (...)
```

**Causes & Fixes:**
1. **Build scripts not approved** → Run `pnpm approve-builds` and select all build-related packages
2. **Corrupted node_modules** → Delete and reinstall:
   ```bash
   rm -rf node_modules pnpm-lock.yaml
   pnpm install
   pnpm approve-builds
   ```
3. **Native module compilation failed** → Check electron-rebuild output:
   ```bash
   pnpm install
   ```

### Issue: better-sqlite3 Build Fails
- Requires Python and build tools
- On macOS: Xcode Command Line Tools (`xcode-select --install`)
- Rebuild: `pnpm install` (triggers postinstall)

### Issue: Hot Reload Not Working
- Kill and restart `pnpm dev`
- Check that main process built successfully (look for "electron main process built successfully")

---

## 📝 Git Ignore Rules

Key patterns to ignore (already in .gitignore):
- `node_modules/` - Dependencies
- `out/` - Build output
- `.env*` - Environment variables
- `pnpm-lock.yaml` - (Sometimes; depends on project policy)
- `dist/` - Production builds

---

## 📦 Dependencies Summary

| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^39.2.6 | Desktop app framework |
| react | ^19.2.1 | UI framework |
| typescript | ^5.9.3 | Type safety |
| vite | ^7.2.6 | Build tool |
| electron-vite | ^5.0.0 | Electron + Vite integration |
| sharp | ^0.35.3 | Image processing |
| better-sqlite3 | ^12.11.1 | Database |
| libraw-wasm | ^1.6.0 | RAW image support |
| exifr | ^7.1.3 | EXIF metadata |
| electron-builder | ^26.0.12 | Packaging |

---

## 🔐 Security Notes

- **Sandbox:** Renderer process is sandboxed for security
- **IPC:** Main ↔ Renderer communication via ipcMain/ipcRenderer (whitelisted in preload)
- **External Links:** Opened via `shell.openExternal()` (never in-app)
- **Preload Script:** Exposes only safe APIs to renderer; protects direct Electron access

---

## 📚 Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [electron-vite GitHub](https://github.com/alex8088/electron-vite)
- [electron-builder Documentation](https://www.electron.build)
- [Vite Documentation](https://vitejs.dev)
- [React Documentation](https://react.dev)

---

## 🤝 Contributing

Follow the existing code style:
- Use TypeScript for type safety
- Format with Prettier: `pnpm format`
- Lint with ESLint: `pnpm lint`
- Keep components modular and focused

---

**Last Updated:** 2026-07-13  
**Status:** Development (issue with Electron build scripts resolved via pnpm approve-builds)
