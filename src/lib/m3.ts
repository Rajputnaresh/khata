/**
 * Material Design 3 theme generation.
 *
 * The full M3 color system is derived from a single source color using Google's
 * official HCT (hue-chroma-tone) color engine, then emitted as CSS custom
 * properties under the canonical `--md-sys-color-*` role names. Doing it this
 * way means every foreground/background pair is contrast-checked by the same
 * algorithm Material uses, instead of by hand.
 *
 * Runs at build time — the browser gets plain CSS variables, zero runtime cost.
 */

import { argbFromHex, Hct, MaterialDynamicColors } from '@material/material-color-utilities'
import { BrandScheme } from './brand-scheme'

/** Brand seed. Warm saffron reads as "ledger/India" without being generic. */
export const SEED = '#E8734A'

/** Material's canonical role list, in spec order. */
const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'inversePrimary',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'warning', 'onWarning', 'warningContainer', 'onWarningContainer',
  'success', 'onSuccess', 'successContainer', 'onSuccessContainer',
  'background', 'onBackground',
  'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
  'surfaceDim', 'surfaceBright',
  'surfaceContainerLowest', 'surfaceContainerLow', 'surfaceContainer',
  'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant',
  'inverseSurface', 'inverseOnSurface', 'inverseSurfaceVariant',
  'scrim', 'shadow',
] as const

export type M3Role = (typeof ROLES)[number]

const CSS_NAME: Record<M3Role, string> = {
  primary: 'primary',
  onPrimary: 'on-primary',
  primaryContainer: 'primary-container',
  onPrimaryContainer: 'on-primary-container',
  inversePrimary: 'inverse-primary',
  secondary: 'secondary',
  onSecondary: 'on-secondary',
  secondaryContainer: 'secondary-container',
  onSecondaryContainer: 'on-secondary-container',
  tertiary: 'tertiary',
  onTertiary: 'on-tertiary',
  tertiaryContainer: 'tertiary-container',
  onTertiaryContainer: 'on-tertiary-container',
  error: 'error',
  onError: 'on-error',
  errorContainer: 'error-container',
  onErrorContainer: 'on-error-container',
  warning: 'warning',
  onWarning: 'on-warning',
  warningContainer: 'warning-container',
  onWarningContainer: 'on-warning-container',
  success: 'success',
  onSuccess: 'on-success',
  successContainer: 'success-container',
  onSuccessContainer: 'on-success-container',
  background: 'background',
  onBackground: 'on-background',
  surface: 'surface',
  onSurface: 'on-surface',
  surfaceVariant: 'surface-variant',
  onSurfaceVariant: 'on-surface-variant',
  surfaceDim: 'surface-dim',
  surfaceBright: 'surface-bright',
  surfaceContainerLowest: 'surface-container-lowest',
  surfaceContainerLow: 'surface-container-low',
  surfaceContainer: 'surface-container',
  surfaceContainerHigh: 'surface-container-high',
  surfaceContainerHighest: 'surface-container-highest',
  outline: 'outline',
  outlineVariant: 'outline-variant',
  inverseSurface: 'inverse-surface',
  inverseOnSurface: 'inverse-on-surface',
  inverseSurfaceVariant: 'inverse-surface-variant',
  scrim: 'scrim',
  shadow: 'shadow',
}

function hex(argb: number): string {
  return `#${argb.toString(16).padStart(8, '0').slice(2).toUpperCase()}`
}

/** Build a full light + dark scheme from one seed colour. */
function schemesFrom(seedHex: string) {
  return {
    light: new BrandScheme(seedHex, false, 0),
    dark: new BrandScheme(seedHex, true, 0),
  }
}

export interface M3Theme {
  light: Record<string, string>
  dark: Record<string, string>
  /** Category accents, tone-mapped so they sit correctly on both surfaces. */
  accents: Record<string, { light: string; dark: string }>
}

export function buildM3Theme(seedHex = SEED): M3Theme {
  const { light, dark } = schemesFrom(seedHex)

  const out = (s: BrandScheme, extra: Record<string, number> = {}): Record<string, string> => {
    const rec: Record<string, string> = {}
    for (const role of ROLES) {
      // M3 core roles come from the scheme; success/warning are M3 "extended"
      // roles we derive from fixed hues so the palette stays coherent.
      const v =
        (s as unknown as Record<string, number>)[role] ??
        extra[role] ??
        fallbackTone(role, s)
      if (v !== undefined) rec[CSS_NAME[role]] = hex(v)
    }
    return rec
  }

  // M3 extended roles: success stays green, warning stays amber, each toned to
  // match the scheme's own light/dark context.
  const ext = (dark: boolean) => ({
    warning: tone(Hct.fromInt(argbFromHex('#D9A23B')), dark),
    onWarning: dark ? 0xff2b1a00 : 0xffffffff,
    warningContainer: tone(Hct.fromInt(argbFromHex('#D9A23B')), dark, 30),
    onWarningContainer: dark ? 0xffffdea8 : 0x2a1a00,
    success: tone(Hct.fromInt(argbFromHex('#3E9C6A')), dark, 40),
    onSuccess: dark ? 0x00150b : 0xffffffff,
    successContainer: tone(Hct.fromInt(argbFromHex('#3E9C6A')), dark, 30),
    onSuccessContainer: dark ? 0x9df2bd : 0x00210f,
  })

  return {
    light: out(light, ext(false)),
    dark: out(dark, ext(true)),
    accents: {},
  }
}

/** Tone a seed to the tone a role should occupy. */
function tone(hct: Hct, dark: boolean, containerTone?: number): number {
  if (containerTone !== undefined) return Hct.from(hct.hue, Math.min(36, hct.chroma), containerTone).toInt()
  return Hct.from(hct.hue, hct.chroma, dark ? 80 : 40).toInt()
}

/** Roles the scheme object does not define, mapped by spec tone. */
function fallbackTone(role: M3Role, s: BrandScheme): number | undefined {
  const surface = s.surface
  const isDark = luminance(surface) < 0.5
  const spec: Partial<Record<M3Role, number>> = {
    scrim: 0x000000,
    shadow: 0x000000,
    surfaceDim: isDark ? 0x14110f : 0xd9d6d0,
    surfaceBright: isDark ? 0x3b3833 : 0xfff8f2,
    inverseSurfaceVariant: isDark ? 0x4e454d : 0xe6e0e9,
  }
  return spec[role]
}

function luminance(argb: number): number {
  const channel = (i: number): number => ((argb >> i) & 0xff) / 255
  const f = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * f(channel(0)) + 0.7152 * f(channel(8)) + 0.0722 * f(channel(16))
}

/**
 * Category colours must stay recognisable, but raw brand hexes fail contrast on
 * one surface or the other. Tone each into a container role for its mode so a
 * chip is always readable, and keep the original hue for the chart fills.
 */
const ACCENT_SEEDS: Record<string, string> = {
  saffron: '#E8734A',
  mint: '#3E9C6A',
  clay: '#C4577B',
  amber: '#D9A23B',
  slateBlue: '#4E8FD4',
  teal: '#2E9E8F',
  violet: '#8B6BC7',
}

export interface AccentToken {
  /** Chart fill / icon colour — vivid, tuned for the current surface. */
  solid: string
  /** Text/icon on a low-emphasis tinted background. */
  onContainer: string
  /** The tint itself. */
  container: string
}

export function accentFor(seedHex: string, dark: boolean): AccentToken {
  const hct = Hct.fromInt(argbFromHex(seedHex))
  const solidTone = dark ? 75 : 45
  const containerTone = dark ? 30 : 90
  const onContainerTone = dark ? 90 : 25
  return {
    solid: hex(Hct.from(hct.hue, hct.chroma, solidTone).toInt()),
    container: hex(Hct.from(hct.hue, hct.chroma * 0.4, containerTone).toInt()),
    onContainer: hex(Hct.from(hct.hue, hct.chroma * 0.8, onContainerTone).toInt()),
  }
}

export function allAccents(dark: boolean): Record<string, AccentToken> {
  const out: Record<string, AccentToken> = {}
  for (const [name, seed] of Object.entries(ACCENT_SEEDS)) out[name] = accentFor(seed, dark)
  return out
}

/* ------------------------------------------------------------------ */
/*  CSS emission                                                       */
/* ------------------------------------------------------------------ */

function block(vars: Record<string, string>, indent = '  '): string {
  return Object.entries(vars)
    .map(([k, v]) => `${indent}--md-sys-color-${k}: ${v.toLowerCase()};`)
    .join('\n')
}

export function themeCss(seedHex = SEED): string {
  const t = buildM3Theme(seedHex)
  return `/* ==========================================================================
   Material Design 3 — generated from @material/material-color-utilities
   Seed: ${seedHex}
   Do not edit by hand: regenerate with \`npm run theme\`.
   ========================================================================== */

:root {
  color-scheme: light;

  /* ---- Material 3 color roles (light) ---- */
${block(t.light)}

  /* ---- Type scale: Material 3 ---- */
  --md-sys-typescale-display-large-size: 3.5625rem;
  --md-sys-typescale-display-large-line: 4rem;
  --md-sys-typescale-display-large-weight: 400;
  --md-sys-typescale-display-large-tracking: -0.0156rem;

  --md-sys-typescale-headline-large-size: 2rem;
  --md-sys-typescale-headline-large-line: 2.5rem;
  --md-sys-typescale-headline-large-weight: 400;
  --md-sys-typescale-headline-large-tracking: 0rem;

  --md-sys-typescale-headline-medium-size: 1.75rem;
  --md-sys-typescale-headline-medium-line: 2.25rem;
  --md-sys-typescale-headline-medium-weight: 400;

  --md-sys-typescale-title-large-size: 1.375rem;
  --md-sys-typescale-title-large-line: 1.75rem;
  --md-sys-typescale-title-large-weight: 500;
  --md-sys-typescale-title-large-tracking: 0.0098rem;

  --md-sys-typescale-title-medium-size: 1rem;
  --md-sys-typescale-title-medium-line: 1.5rem;
  --md-sys-typescale-title-medium-weight: 500;
  --md-sys-typescale-title-medium-tracking: 0.0098rem;

  --md-sys-typescale-title-small-size: 0.875rem;
  --md-sys-typescale-title-small-line: 1.25rem;
  --md-sys-typescale-title-small-weight: 500;
  --md-sys-typescale-title-small-tracking: 0.0078rem;

  --md-sys-typescale-body-large-size: 1rem;
  --md-sys-typescale-body-large-line: 1.5rem;
  --md-sys-typescale-body-large-weight: 400;
  --md-sys-typescale-body-large-tracking: 0.0313rem;

  --md-sys-typescale-body-medium-size: 0.875rem;
  --md-sys-typescale-body-medium-line: 1.25rem;
  --md-sys-typescale-body-medium-weight: 400;
  --md-sys-typescale-body-medium-tracking: 0.0156rem;

  --md-sys-typescale-body-small-size: 0.75rem;
  --md-sys-typescale-body-small-line: 1rem;
  --md-sys-typescale-body-small-weight: 400;
  --md-sys-typescale-body-small-tracking: 0.0333rem;

  --md-sys-typescale-label-large-size: 0.875rem;
  --md-sys-typescale-label-large-line: 1.25rem;
  --md-sys-typescale-label-large-weight: 500;
  --md-sys-typescale-label-large-tracking: 0.0063rem;

  --md-sys-typescale-label-medium-size: 0.75rem;
  --md-sys-typescale-label-medium-line: 1rem;
  --md-sys-typescale-label-medium-weight: 500;
  --md-sys-typescale-label-medium-tracking: 0.0313rem;

  --md-sys-typescale-label-small-size: 0.6875rem;
  --md-sys-typescale-label-small-line: 1rem;
  --md-sys-typescale-label-small-weight: 500;
  --md-sys-typescale-label-small-tracking: 0.0333rem;

  /* ---- Shape: Material 3 corner scale ---- */
  --md-sys-shape-corner-none: 0rem;
  --md-sys-shape-corner-extra-small: 0.25rem;
  --md-sys-shape-corner-small: 0.5rem;
  --md-sys-shape-corner-medium: 0.75rem;
  --md-sys-shape-corner-large: 1rem;
  --md-sys-shape-corner-extra-large: 1.75rem;
  --md-sys-shape-corner-full: 62.5rem;

  /* ---- Motion: Material 3 easing ---- */
  --md-sys-motion-easing-standard: cubic-bezier(0.2, 0, 0, 1);
  --md-sys-motion-easing-emphasized: cubic-bezier(0.2, 0, 0, 1);
  --md-sys-motion-easing-standard-decelerate: cubic-bezier(0, 0, 0, 1);
  --md-sys-motion-easing-standard-accelerate: cubic-bezier(0.3, 0, 1, 1);
  --md-sys-motion-duration-short2: 100ms;
  --md-sys-motion-duration-short4: 200ms;
  --md-sys-motion-duration-medium2: 300ms;
  --md-sys-motion-duration-medium4: 400ms;
  --md-sys-motion-duration-long2: 500ms;

  /* ---- Elevation ---- */
  --md-sys-elevation-level0: none;
  --md-sys-elevation-level1: 0 1px 2px rgb(0 0 0 / 0.30), 0 1px 3px 1px rgb(0 0 0 / 0.15);
  --md-sys-elevation-level2: 0 1px 2px rgb(0 0 0 / 0.30), 0 2px 6px 2px rgb(0 0 0 / 0.15);
  --md-sys-elevation-level3: 0 4px 8px 3px rgb(0 0 0 / 0.15), 0 1px 3px rgb(0 0 0 / 0.30);
  --md-sys-elevation-level4: 0 6px 10px 4px rgb(0 0 0 / 0.15), 0 2px 3px rgb(0 0 0 / 0.30);
  --md-sys-elevation-level5: 0 8px 12px 6px rgb(0 0 0 / 0.15), 0 4px 4px rgb(0 0 0 / 0.30);

  /* ---- Category accents (light) ---- */
${block(accentCss(false), '  ')}
}

.dark {
  color-scheme: dark;

  /* ---- Material 3 color roles (dark) ---- */
${block(t.dark, '  ')}

  /* ---- Category accents (dark) ---- */
${block(accentCss(true), '  ')}
}
`
}

/** Flatten the accent tokens into `--md-sys-color-cat-*-*` variables. */
function accentCss(dark: boolean): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, a] of Object.entries(allAccents(dark))) {
    out[`cat-${name}-solid`] = a.solid
    out[`cat-${name}-container`] = a.container
    out[`cat-${name}-on-container`] = a.onContainer
  }
  return out
}

export { MaterialDynamicColors }
