/**
 * Backup crypto. Everything is Web Crypto — no dependencies.
 *
 * Passphrase -> PBKDF2-SHA256 (600k iters, OWASP 2023) -> AES-256-GCM key.
 * The salt and the IV travel with the file; the passphrase never leaves the phone.
 * Google Drive only ever sees ciphertext.
 */

const PBKDF2_ITERATIONS = 600_000
const SALT_BYTES = 16
const IV_BYTES = 12
const VERSION = 1

const enc = new TextEncoder()
const dec = new TextDecoder()

function b64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(s)
}

function unb64(str: string): Uint8Array {
  const bin = atob(str)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase.normalize('NFKC')), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export interface BackupEnvelope {
  v: number
  /** ms since epoch, set at encrypt time. */
  t: number
  alg: 'AES-256-GCM'
  kdf: 'PBKDF2-SHA256'
  iters: number
  salt: string
  iv: string
  /** base64 ciphertext. */
  data: string
}

export interface Snapshot {
  app: string
  version: number
  createdAt: number
  device: string
  settings: unknown
  categories: unknown[]
  tx: unknown[]
}

/** Encrypt a snapshot into a self-describing envelope. */
export async function encryptSnapshot(snapshot: Snapshot, passphrase: string): Promise<BackupEnvelope> {
  if (passphrase.length < 6) throw new Error('Passphrase must be at least 6 characters')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(passphrase, salt)
  const plain = enc.encode(JSON.stringify(snapshot))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, plain)
  return {
    v: VERSION,
    t: Date.now(),
    alg: 'AES-256-GCM',
    kdf: 'PBKDF2-SHA256',
    iters: PBKDF2_ITERATIONS,
    salt: b64(salt),
    iv: b64(iv),
    data: b64(cipher),
  }
}

export class DecryptError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DecryptError'
  }
}

/** Decrypt an envelope. A wrong passphrase fails the GCM auth tag, not silently. */
export async function decryptEnvelope(envelope: BackupEnvelope, passphrase: string): Promise<Snapshot> {
  if (envelope.v !== VERSION) throw new DecryptError(`Unsupported backup version ${envelope.v}`)
  const salt = unb64(envelope.salt)
  const iv = unb64(envelope.iv)
  const key = await deriveKey(passphrase, salt)
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      unb64(envelope.data) as BufferSource,
    )
    const parsed = JSON.parse(dec.decode(plain)) as Snapshot
    if (!parsed || !Array.isArray(parsed.tx) || !Array.isArray(parsed.categories)) {
      throw new DecryptError('Backup payload is not a valid Khata snapshot')
    }
    return parsed
  } catch (err) {
    if (err instanceof DecryptError) throw err
    throw new DecryptError('Wrong passphrase, or the backup file is damaged')
  }
}

/** Standalone verification, used by the "Test restore" button. */
export async function verifyPassphrase(envelope: BackupEnvelope, passphrase: string): Promise<boolean> {
  try {
    await decryptEnvelope(envelope, passphrase)
    return true
  } catch {
    return false
  }
}

/**
 * Passphrase strength, estimated as real entropy in bits.
 * Length dominates; character-class variety adds a bonus, but repetition of a
 * short pattern is penalised so "aaaaaaaaaaaa" does not read as strong.
 */
export function passphraseStrength(p: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!p) return { score: 0, label: 'Empty' }
  if (p.length < 6) return { score: 0, label: 'Too weak' }

  // ~1 bit per character for a mixed-class passphrase; this is a deliberately
  // conservative estimate so a long passphrase reads as strong.
  let bits = p.length
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(p)).length
  if (classes >= 3) bits += 12
  else if (classes === 2) bits += 6

  // Penalise a single repeated character or an obvious short repeat.
  const unique = new Set(p).size
  if (unique <= 2) bits *= 0.35
  else if (unique / p.length < 0.4) bits *= 0.7

  const score: 0 | 1 | 2 | 3 | 4 =
    bits < 32 ? 1 : bits < 55 ? 2 : bits < 80 ? 3 : 4
  const label = ['Too weak', 'Weak', 'Fair', 'Strong', 'Excellent'][score] ?? 'Weak'
  return { score, label }
}
