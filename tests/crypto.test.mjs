/**
 * Crypto unit tests. Verifies the real backup envelope behaviour:
 * correct passphrase decrypts, wrong passphrase fails, tampering is detected.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Node >= 20 exposes global Web Crypto, so the module under test runs unmodified.
assert.ok(globalThis.crypto?.subtle, 'Web Crypto must be available')

const { encryptSnapshot, decryptEnvelope, verifyPassphrase, passphraseStrength } = await import(
  '../src/lib/crypto.ts'
)

const snapshot = {
  app: 'khata',
  version: 1,
  createdAt: Date.now(),
  device: 'test',
  settings: { id: 'app', currency: 'INR' },
  categories: [{ id: 'c_food', name: 'Food' }],
  tx: [
    { id: 't1', type: 'expense', amount: 45000, date: '2026-09-30' },
    { id: 't2', type: 'income', amount: 1200000, date: '2026-09-01' },
  ],
}

const PASS = 'correct horse battery staple 42'

describe('backup crypto', () => {
  it('round-trips a snapshot with the correct passphrase', async () => {
    const env = await encryptSnapshot(snapshot, PASS)
    assert.equal(env.alg, 'AES-256-GCM')
    assert.equal(env.kdf, 'PBKDF2-SHA256')
    assert.equal(env.iters, 600000)
    const out = await decryptEnvelope(env, PASS)
    assert.deepEqual(out.tx, snapshot.tx)
    assert.equal(out.categories[0].name, 'Food')
  })

  it('produces ciphertext that does not leak the plaintext', async () => {
    const env = await encryptSnapshot(snapshot, PASS)
    const raw = JSON.stringify(env)
    assert.ok(!raw.includes('45000'), 'amount must not appear in ciphertext')
    assert.ok(!raw.includes('Food'), 'category name must not appear in ciphertext')
    assert.ok(!raw.includes('khata'), 'app marker must not appear in ciphertext')
  })

  it('rejects a wrong passphrase', async () => {
    const env = await encryptSnapshot(snapshot, PASS)
    await assert.rejects(() => decryptEnvelope(env, 'wrong passphrase 999'), /Wrong passphrase/)
    assert.equal(await verifyPassphrase(env, 'nope nope nope'), false)
  })

  it('rejects a tampered ciphertext (GCM auth tag)', async () => {
    const env = await encryptSnapshot(snapshot, PASS)
    // Flip a byte in the base64 payload.
    const bytes = Buffer.from(env.data, 'base64')
    bytes[10] ^= 0xff
    const tampered = { ...env, data: bytes.toString('base64') }
    await assert.rejects(() => decryptEnvelope(tampered, PASS), /Wrong passphrase|damaged/)
  })

  it('uses a fresh salt and IV for every encryption', async () => {
    const a = await encryptSnapshot(snapshot, PASS)
    const b = await encryptSnapshot(snapshot, PASS)
    assert.notEqual(a.salt, b.salt, 'salt must be unique')
    assert.notEqual(a.iv, b.iv, 'iv must be unique')
    assert.notEqual(a.data, b.data, 'ciphertext must differ')
  })

  it('rejects passphrases that are too short', async () => {
    await assert.rejects(() => encryptSnapshot(snapshot, 'short'), /at least 6/)
  })

  it('scores passphrase strength honestly', () => {
    assert.equal(passphraseStrength('').score, 0)
    // Too short to be useful.
    assert.equal(passphraseStrength('123').score, 0)
    // Long but single-class repetition must not read as strong.
    assert.ok(passphraseStrength('aaaaaaaaaaaa').score <= 1, 'repeated chars stay weak')
    // A dictionary-ish password stays weak even though it is 11 chars.
    assert.ok(passphraseStrength('password123').score <= 1, 'common password stays weak')
    // A long mixed passphrase is meaningfully better than the above.
    assert.ok(passphraseStrength(PASS).score >= 2, 'long passphrase beats a common one')
    // Score must be monotonic: a longer, more varied passphrase is never weaker.
    assert.ok(
      passphraseStrength('Tr0ub4dor&3xyZq!2026').score >= passphraseStrength('Tr0ub4dor&3xy').score,
      'strength never decreases as the passphrase improves',
    )
  })
})
