/**
 * Google Drive backup transport.
 *
 * Backups land in the appDataFolder — a hidden per-app area that does not appear
 * in the user's "My Drive", costs no quota against their visible files, and
 * allows an effectively unlimited number of snapshots. Each snapshot is a
 * rotating window (default 30) so Drive storage stays tiny.
 *
 * Auth uses the GIS token model (implicit grant, no client secret). The refresh
 * token is kept in IndexedDB, not localStorage, and never leaves the device.
 */

import { db } from './db'

const CLIENT_ID_KEY = 'khata.gis.clientId'
const TOKEN_KEY = 'khata.gis.refreshToken'
const SCOPES = 'https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const FOLDER_NAME = 'Khata'
const SETTINGS_META_KEY = 'gdrive.clientId'

export const FOLDER = 'appDataFolder'

interface Stored {
  accessToken: string
  refreshToken: string
  expiresAt: number
  clientId: string
}

let cached: Stored | null = null
let inflight: Promise<string> | null = null

/* ---------------- client id ---------------- */

export function getClientId(): string | null {
  try {
    return localStorage.getItem(CLIENT_ID_KEY)
  } catch {
    return null
  }
}

export async function saveClientId(id: string): Promise<void> {
  const clean = id.trim()
  localStorage.setItem(CLIENT_ID_KEY, clean)
  await db.settings.update('app', { backupEnabled: true } as never)
  const s = await db.settings.get('app')
  if (s) await db.meta.put({ key: SETTINGS_META_KEY, value: clean })
  cached = null
}

export async function loadStoredClientId(): Promise<string | null> {
  const fromLocal = getClientId()
  if (fromLocal) return fromLocal
  const row = await db.meta.get(SETTINGS_META_KEY)
  const value = typeof row?.value === 'string' ? row.value : null
  if (value) localStorage.setItem(CLIENT_ID_KEY, value)
  return value
}

/* ---------------- oauth ---------------- */

export function authUrl(clientId: string, redirectUri: string): string {
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'token',
    scope: SCOPES,
    prompt: 'consent',
    include_granted_scopes: 'true',
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`
}

/** Pull `access_token` out of the implicit-grant callback fragment. */
export function parseAuthFragment(hash: string): { accessToken: string; refreshToken: string | null } | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  const p = new URLSearchParams(raw)
  const accessToken = p.get('access_token')
  if (!accessToken) return null
  return { accessToken, refreshToken: p.get('refresh_token') }
}

async function persist(s: Stored): Promise<void> {
  cached = s
  await db.meta.put({ key: TOKEN_KEY, value: s })
}

async function load(): Promise<Stored | null> {
  if (cached) return cached
  const row = await db.meta.get(TOKEN_KEY)
  if (!row?.value) return null
  cached = row.value as Stored
  return cached
}

export async function isConnected(): Promise<boolean> {
  return (await load()) !== null
}

export async function disconnect(): Promise<void> {
  cached = null
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  await db.meta.delete(TOKEN_KEY)
}

async function refresh(): Promise<Stored> {
  const s = await load()
  if (!s) throw new DriveError('Not connected to Google Drive. Tap "Connect" first.')
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: s.clientId,
      refresh_token: s.refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    if (res.status === 400 || res.status === 401) {
      await disconnect()
      throw new DriveError('Google Drive authorisation expired. Please reconnect.', 401)
    }
    throw new DriveError(`Token refresh failed (${res.status})`, res.status)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  const next: Stored = { ...s, accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 - 60_000 }
  await persist(next)
  return next
}

/** Return a valid access token, refreshing if it is within 60s of expiry. */
export async function accessToken(): Promise<string> {
  const s = await load()
  if (!s) throw new DriveError('Not connected to Google Drive. Tap "Connect" first.')
  if (Date.now() < s.expiresAt) return s.accessToken
  // Collapse concurrent refreshes so a burst of API calls triggers one round-trip.
  if (!inflight) {
    inflight = refresh()
      .then((r) => r.accessToken)
      .finally(() => {
        inflight = null
      })
  }
  return inflight
}

/* ---------------- errors ---------------- */

export class DriveError extends Error {
  status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'DriveError'
    this.status = status
  }
}

/* ---------------- drive calls ---------------- */

async function api(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken()
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401) {
    // One retry after a forced refresh before giving up.
    await db.meta.delete(TOKEN_KEY)
    cached = null
    const fresh = await accessToken()
    const retry = await fetch(`${DRIVE_API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${fresh}`, ...(init.headers ?? {}) },
    })
    if (retry.ok) return retry
    throw new DriveError('Google Drive rejected the request. Try reconnecting.', retry.status)
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new DriveError(`Drive error ${res.status}: ${body.slice(0, 200)}`, res.status)
  }
  return res
}

export interface DriveFile {
  id: string
  name: string
  size: number
  modifiedTime: string
}

export async function findFolder(): Promise<string | null> {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${FOLDER_NAME}' and trashed=false`,
  )
  const res = await api(`/files?q=${q}&spaces=${FOLDER}&fields=files(id,name)&pageSize=10`)
  const data = (await res.json()) as { files: { id: string; name: string }[] }
  return data.files[0]?.id ?? null
}

async function ensureFolder(): Promise<string> {
  const existing = await findFolder()
  if (existing) return existing
  const res = await api('/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [FOLDER],
    }),
  })
  const data = (await res.json()) as { id: string }
  return data.id
}

export async function listBackups(): Promise<DriveFile[]> {
  const folderId = await findFolder()
  if (!folderId) return []
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)
  const res = await api(
    `/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,size,modifiedTime)&pageSize=100`,
  )
  const data = (await res.json()) as { files: DriveFile[] }
  return data.files
}

export interface UploadResult {
  id: string
  name: string
  size: number
}

export async function upload(name: string, body: string, folderId?: string): Promise<UploadResult> {
  const target = folderId ?? (await ensureFolder())
  const token = await accessToken()
  const boundary = 'khata-' + Math.random().toString(36).slice(2)
  const metadata = {
    name,
    parents: [target],
    mimeType: 'application/json',
    description: 'Khata encrypted backup (AES-256-GCM). Do not edit.',
  }
  const multipart =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
      metadata,
    )}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`

  const res = await fetch(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,size`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipart,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new DriveError(`Upload failed (${res.status}): ${text.slice(0, 200)}`, res.status)
  }
  const data = (await res.json()) as UploadResult
  return data
}

export async function download(fileId: string): Promise<string> {
  const res = await api(`/files/${fileId}?alt=media`)
  return res.text()
}

export async function trash(fileId: string): Promise<void> {
  await api(`/files/${fileId}`, { method: 'DELETE' })
}

export async function quota(): Promise<{ used: number; limit: number } | null> {
  try {
    const res = await api('/about?fields=storageQuota')
    const data = (await res.json()) as { storageQuota?: { limit?: string; usage?: string } }
    const q = data.storageQuota
    if (!q?.limit) return null
    return { used: Number(q.usage ?? 0), limit: Number(q.limit) }
  } catch {
    return null
  }
}

/* ---------------- full backup cycle ---------------- */

export interface BackupReport {
  fileId: string
  name: string
  size: number
  txCount: number
  removed: number
  at: number
}

export interface BackupInput {
  envelope: string
  txCount: number
  name: string
  keep: number
}

export async function runBackup(input: BackupInput): Promise<BackupReport> {
  const folderId = await ensureFolder()
  const created = await upload(input.name, input.envelope, folderId)
  const all = await listBackups()
  const stale = all.slice(input.keep)
  for (const f of stale) {
    await trash(f.id).catch(() => undefined)
  }
  return {
    fileId: created.id,
    name: created.name,
    size: created.size,
    txCount: input.txCount,
    removed: stale.length,
    at: Date.now(),
  }
}

export function backupNameFor(iso: string): string {
  return `khata-${iso}-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}.json`
}

export { TOKEN_KEY, SCOPES }
