#!/usr/bin/env node
/**
 * Generates the PWA icon set from an inline SVG. No native deps — writes
 * a minimal valid PNG by hand (solid rounded square + mark) so the repo
 * stays dependency-free. Rerun after editing the SVG below.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

// Palette matches the app: warm saffron on deep ink.
const BG = [20, 17, 15]
const FG = [232, 115, 74]
const PAPER = [244, 239, 232]

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

function png(size, painter) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = painter(x, y, size)
      const i = rowStart + 1 + x * 4
      raw[i] = r
      raw[i + 1] = g
      raw[i + 2] = b
      raw[i + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Rounded-square mask matching the app's 18% corner radius feel. */
function inRounded(x, y, size, radius, inset = 0) {
  const lo = inset
  const hi = size - inset - 1
  if (x < lo || x > hi || y < lo || y > hi) return false
  const cx = Math.min(Math.max(x, lo + radius), hi - radius)
  const cy = Math.min(Math.max(y, lo + radius), hi - radius)
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= radius * radius
}

/** A simple ledger/wallet glyph: a rounded card with a rising line. */
function paintIcon(x, y, size, maskable) {
  const s = size
  if (!inRounded(x, y, s, maskable ? s * 0.5 : s * 0.22, maskable ? 0 : 0)) return [0, 0, 0, 0]

  const u = s / 100 // work in a 100x100 design space
  const cx = x + 0.5
  const cy = y + 0.5

  // Card body (paper) with saffron edge.
  const cardW = 56 * u
  const cardH = 40 * u
  const cardX = cx - cardW / 2
  const cardY = cy - cardH / 2 - 2 * u
  const inCard =
    inRounded(cx - cardX, cy - cardY, cardW, 6 * u, 0) && inRounded(cardX, cardY, cardW, 0, 0)
  // simpler: explicit bounds check
  const insideCard =
    cx >= cardX && cx <= cardX + cardW && cy >= cardY && cy <= cardY + cardH && inRounded(cx - cardX, cy - cardY, cardW, 6 * u, 0)

  // Rising trend line inside the card.
  const lx0 = cardX + 12 * u
  const lx1 = cardX + cardW - 12 * u
  const ly0 = cardY + cardH - 11 * u
  const ly1 = cardY + 11 * u
  const t = (cx - lx0) / (lx1 - lx0)
  const lineY = ly0 + (ly1 - ly0) * Math.max(0, Math.min(1, t))
  const onLine = t >= 0 && t <= 1 && Math.abs(cy - lineY) <= 3.2 * u

  if (insideCard) {
    if (onLine) return [...FG, 255]
    // Bar ticks along the bottom of the card.
    const barCount = 3
    for (let i = 0; i < barCount; i++) {
      const bx = cardX + (14 + i * 14) * u
      const bh = (6 + i * 4) * u
      if (cx >= bx && cx <= bx + 7 * u && cy >= cardY + cardH - 6 * u - bh && cy <= cardY + cardH - 6 * u) {
        return [...FG, 255]
      }
    }
    return [...PAPER, 255]
  }

  if (inCard) return [...PAPER, 255]
  return [...BG, 255]
}

function paintMaskable(x, y, size) {
  // Maskable: keep the mark inside the safe zone (80% centre circle).
  const s = size
  if (!inRounded(x, y, s, s * 0.5, 0)) return [...BG, 255]
  const [r, g, b] = paintIcon(x, y, s, true)
  if (a(r, g, b)) return [r, g, b, 255]
  return [...BG, 255]
}
function a(r, g, b) {
  return r > 0 || g > 0 || b > 0
}

for (const size of [192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, (x, y) => paintIcon(x, y, size, false)))
  writeFileSync(join(OUT, `maskable-${size}.png`), png(size, (x, y) => paintMaskable(x, y, size)))
}

// Screenshots referenced by the manifest: solid brand panels (valid PNGs).
for (const [name, w, h] of [
  ['shot-wide.png', 1280, 720],
  ['shot-narrow.png', 540, 960],
]) {
  writeFileSync(
    join(OUT, name),
    png(w, (x, y) => {
      const t = y / h
      const r = Math.round(20 * (1 - t) + 30 * t)
      const g = Math.round(17 * (1 - t) + 24 * t)
      const b = Math.round(15 * (1 - t) + 20 * t)
      // subtle saffron glow top-right
      const dx = (x - w * 0.82) / (w * 0.35)
      const dy = (y - h * 0.15) / (h * 0.35)
      const glow = Math.max(0, 1 - (dx * dx + dy * dy))
      return [
        Math.min(255, r + glow * 60),
        Math.min(255, g + glow * 28),
        Math.min(255, b + glow * 16),
        255,
      ]
    }),
  )
}

console.log('icons written to', OUT)
