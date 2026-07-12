import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'

const userDataPath = app.getPath('userData')
mkdirSync(userDataPath, { recursive: true })
const DB_PATH = join(userDataPath, 'catalog.db')

const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path TEXT NOT NULL UNIQUE,
    folder_path TEXT NOT NULL,
    filename TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    size INTEGER,
    date_taken TEXT,
    camera_make TEXT,
    camera_model TEXT,
    iso INTEGER,
    aperture REAL,
    shutter_speed TEXT,
    focal_length REAL,
    thumbnail BLOB,
    added_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS edits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL UNIQUE,
    exposure REAL NOT NULL DEFAULT 0,
    contrast REAL NOT NULL DEFAULT 0,
    highlights REAL NOT NULL DEFAULT 0,
    shadows REAL NOT NULL DEFAULT 0,
    whites REAL NOT NULL DEFAULT 0,
    blacks REAL NOT NULL DEFAULT 0,
    temperature INTEGER NOT NULL DEFAULT 0,
    tint INTEGER NOT NULL DEFAULT 0,
    saturation REAL NOT NULL DEFAULT 0,
    vibrance REAL NOT NULL DEFAULT 0,
    sharpness REAL NOT NULL DEFAULT 0,
    noise_reduction REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS local_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'radial',
    points_json TEXT,
    cx REAL NOT NULL DEFAULT 0.5,
    cy REAL NOT NULL DEFAULT 0.5,
    rx REAL NOT NULL DEFAULT 0.25,
    ry REAL NOT NULL DEFAULT 0.2,
    feather REAL NOT NULL DEFAULT 0.5,
    invert INTEGER NOT NULL DEFAULT 0,
    exposure REAL NOT NULL DEFAULT 0,
    contrast REAL NOT NULL DEFAULT 0,
    highlights REAL NOT NULL DEFAULT 0,
    shadows REAL NOT NULL DEFAULT 0,
    whites REAL NOT NULL DEFAULT 0,
    blacks REAL NOT NULL DEFAULT 0,
    temperature INTEGER NOT NULL DEFAULT 0,
    tint INTEGER NOT NULL DEFAULT 0,
    saturation REAL NOT NULL DEFAULT 0,
    vibrance REAL NOT NULL DEFAULT 0,
    sharpness REAL NOT NULL DEFAULT 0,
    noise_reduction REAL NOT NULL DEFAULT 0,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
  );
`)

// Lightweight migrations for existing catalogs.
const localCols = (db.prepare(`PRAGMA table_info(local_adjustments)`).all() as Array<{ name: string }>).map((c) => c.name)
if (!localCols.includes('kind')) {
  db.exec(`ALTER TABLE local_adjustments ADD COLUMN kind TEXT NOT NULL DEFAULT 'radial'`)
}
if (!localCols.includes('points_json')) {
  db.exec(`ALTER TABLE local_adjustments ADD COLUMN points_json TEXT`)
}

export const stmts = {
  insertPhoto: db.prepare(`
    INSERT OR IGNORE INTO photos (file_path, folder_path, filename, width, height, size, date_taken, camera_make, camera_model, iso, aperture, shutter_speed, focal_length, thumbnail)
    VALUES (@file_path, @folder_path, @filename, @width, @height, @size, @date_taken, @camera_make, @camera_model, @iso, @aperture, @shutter_speed, @focal_length, @thumbnail)
  `),
  getPhotosByFolder: db.prepare(`SELECT * FROM photos WHERE folder_path = ? ORDER BY date_taken DESC`),
  getPhotoById: db.prepare(`SELECT * FROM photos WHERE id = ?`),
  getPhotoByPath: db.prepare(`SELECT * FROM photos WHERE file_path = ?`),
  updatePhotoThumbnail: db.prepare(`UPDATE photos SET thumbnail = ? WHERE id = ?`),
  getEditsByPhotoId: db.prepare(`SELECT * FROM edits WHERE photo_id = ?`),
  upsertEdits: db.prepare(`
    INSERT INTO edits (photo_id, exposure, contrast, highlights, shadows, whites, blacks, temperature, tint, saturation, vibrance, sharpness, noise_reduction, updated_at)
    VALUES (@photo_id, @exposure, @contrast, @highlights, @shadows, @whites, @blacks, @temperature, @tint, @saturation, @vibrance, @sharpness, @noise_reduction, datetime('now'))
    ON CONFLICT(photo_id) DO UPDATE SET
      exposure = @exposure, contrast = @contrast, highlights = @highlights,
      shadows = @shadows, whites = @whites, blacks = @blacks,
      temperature = @temperature, tint = @tint, saturation = @saturation,
      vibrance = @vibrance, sharpness = @sharpness, noise_reduction = @noise_reduction,
      updated_at = datetime('now')
  `),
  deletePhoto: db.prepare(`DELETE FROM photos WHERE id = ?`),
  getLocalsByPhotoId: db.prepare(`SELECT * FROM local_adjustments WHERE photo_id = ? ORDER BY id`),
  getLocalById: db.prepare(`SELECT * FROM local_adjustments WHERE id = ?`),
  insertLocal: db.prepare(`
    INSERT INTO local_adjustments (photo_id, kind, points_json)
    VALUES (?, ?, ?)
    RETURNING *
  `),
  insertLocalFull: db.prepare(`
    INSERT INTO local_adjustments (
      photo_id, kind, points_json, cx, cy, rx, ry, feather, invert,
      exposure, contrast, highlights, shadows, whites, blacks,
      temperature, tint, saturation, vibrance, sharpness, noise_reduction
    ) VALUES (
      @photo_id, @kind, @points_json, @cx, @cy, @rx, @ry, @feather, @invert,
      @exposure, @contrast, @highlights, @shadows, @whites, @blacks,
      @temperature, @tint, @saturation, @vibrance, @sharpness, @noise_reduction
    )
  `),
  deleteLocalsByPhotoId: db.prepare(`DELETE FROM local_adjustments WHERE photo_id = ?`),
  updateLocal: db.prepare(`
    UPDATE local_adjustments SET
      kind=@kind, points_json=@points_json,
      cx=@cx, cy=@cy, rx=@rx, ry=@ry, feather=@feather, invert=@invert,
      exposure=@exposure, contrast=@contrast, highlights=@highlights, shadows=@shadows,
      whites=@whites, blacks=@blacks, temperature=@temperature, tint=@tint,
      saturation=@saturation, vibrance=@vibrance, sharpness=@sharpness, noise_reduction=@noise_reduction
    WHERE id=@id
  `),
  deleteLocal: db.prepare(`DELETE FROM local_adjustments WHERE id = ?`),
}

export default db
