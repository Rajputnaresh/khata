/**
 * Brand-pinned Material 3 scheme.
 *
 * `SchemeTonalSpot` deliberately desaturates and re-tones a seed, which drifts a
 * saturated brand colour toward a muted pastel (saffron became dusty rose). Its
 * roles are also prototype getters, so they cannot be assigned to.
 *
 * This subclass pins only the primary family to the seed's own hue, keeping the
 * seed's chroma so the brand stays recognisable, while every other role
 * (neutrals, secondary, tertiary, surfaces) continues to come from Google's
 * generated scheme — so the palette stays internally coherent and contrast-safe.
 */
import { argbFromHex, Hct, SchemeTonalSpot, type DynamicScheme } from '@material/material-color-utilities'

/** Tone for the primary fill. 40 on light / 80 on dark keeps AA against the
 *  generated surface and lets on-primary sit at black-or-white by contrast. */
const PRIMARY_TONE_LIGHT = 45
const PRIMARY_TONE_DARK = 75

function bestOn(argb: number): number {
  return contrastRatio(0xffffffff, argb) >= contrastRatio(0xff000000, argb)
    ? 0xffffffff
    : 0xff000000
}

function contrastRatio(a: number, b: number): number {
  const l1 = luminance(a)
  const l2 = luminance(b)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

function luminance(argb: number): number {
  const channel = (i: number): number => ((argb >> i) & 0xff) / 255
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(channel(0)) + 0.7152 * f(channel(8)) + 0.0722 * f(channel(16))
}

export class BrandScheme extends SchemeTonalSpot {
  private readonly _primary: number
  private readonly _onPrimary: number
  private readonly _primaryContainer: number
  private readonly _onPrimaryContainer: number
  private readonly _inversePrimary: number

  constructor(seedHex: string, isDark: boolean, contrastLevel = 0) {
    super(Hct.fromInt(argbFromHex(seedHex)), isDark, contrastLevel)
    const seed = Hct.fromInt(argbFromHex(seedHex))
    this._primary = Hct.from(seed.hue, seed.chroma, isDark ? PRIMARY_TONE_DARK : PRIMARY_TONE_LIGHT).toInt()
    this._onPrimary = bestOn(this._primary)
    this._primaryContainer = Hct.from(
      seed.hue,
      Math.min(38, seed.chroma),
      isDark ? 30 : 90,
    ).toInt()
    this._onPrimaryContainer = Hct.from(
      seed.hue,
      Math.min(46, seed.chroma),
      isDark ? 90 : 25,
    ).toInt()
    this._inversePrimary = Hct.from(
      seed.hue,
      Math.min(60, seed.chroma),
      isDark ? 40 : 80,
    ).toInt()
  }

  override get primary(): number {
    return this._primary
  }
  override get onPrimary(): number {
    return this._onPrimary
  }
  override get primaryContainer(): number {
    return this._primaryContainer
  }
  override get onPrimaryContainer(): number {
    return this._onPrimaryContainer
  }
  override get inversePrimary(): number {
    return this._inversePrimary
  }
}

// Keep the DynamicScheme import meaningful for consumers of this module.
export type { DynamicScheme }
