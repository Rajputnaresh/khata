/**
 * Liquid-glass refraction, applied only where it genuinely works.
 *
 * `backdrop-filter: url(#filter)` is Chromium-only. The nasty part: Firefox
 * *parses* url() in backdrop-filter as valid, so an `@supports` check passes,
 * and then Firefox renders nothing at all — an invisible panel with zero
 * warnings. There is no feature query that separates the two.
 *
 * So we gate on the user agent instead, and only ever add a class. If the UA
 * gate is wrong the user still gets a perfectly good frosted pane; they just
 * don't get the edge refraction.
 */
import { useEffect } from 'react'

/** Chromium and other Blink/WebKit engines that honour SVG filters in backdrop-filter. */
function supportsRefraction(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // Firefox/Gecko explicitly does not render url() backdrop filters.
  if (/Firefox|Gecko|Edg\//i.test(ua)) return false
  if (/Chrome|Chromium|Safari|CriOS|EdgA|OPR|Android/i.test(ua)) {
    // Confirm backdrop-filter exists at all before trusting the engine.
    return (
      typeof CSS !== 'undefined' &&
      CSS.supports?.('backdrop-filter', 'blur(1px)') === true
    )
  }
  return false
}

export function useGlassRefraction() {
  useEffect(() => {
    if (!supportsRefraction()) return
    const el = document.documentElement
    el.classList.add('glass-refract')
    return () => el.classList.remove('glass-refract')
  }, [])
}

/**
 * The displacement map used by the lens. A smooth radial gradient encoded as
 * RGB channels, so the centre (neutral displacement) passes the backdrop
 * through unchanged and the edges bend it.
 */
export function GlassLens() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: 'absolute' }}>
      <defs>
        <filter id="glass-lens" x="-20%" y="-20%" width="140%" height="140%">
          <feImage
            href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cdefs%3E%3CradialGradient id='g' cx='50%25' cy='50%25' r='70%25'%3E%3Cstop offset='0%25' stop-color='%23808080'/%3E%3Cstop offset='70%25' stop-color='%23808080'/%3E%3Cstop offset='100%25' stop-color='%23c0c0c0'/%3E%3C/radialGradient%3E%3C/defs%3E%3Crect width='200' height='200' fill='url(%23g)'/%3E%3C/svg%3E"
            result="map"
            preserveAspectRatio="none"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale="28"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  )
}
