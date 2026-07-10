// Deterministic, offline SVG "photos" for gym listings and avatars.
// Everything is generated from a string seed so listings always render the same
// image without any network dependency.

function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0)
}

function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const GYM_PALETTES: [string, string][] = [
  ['#1f2937', '#4b5563'],
  ['#0f172a', '#334155'],
  ['#1e1b4b', '#4338ca'],
  ['#3f0d12', '#a83240'],
  ['#0b3d2e', '#128a5f'],
  ['#3a2c0a', '#b7791f'],
  ['#111827', '#6b7280'],
  ['#2a1215', '#7c2d3a'],
]

// A few equipment silhouettes drawn as SVG so cards feel gym-specific.
function barbell(x: number, y: number, c: string): string {
  return `
    <g transform="translate(${x} ${y})" fill="${c}">
      <rect x="-95" y="-6" width="190" height="12" rx="6"/>
      <rect x="-95" y="-26" width="16" height="52" rx="4"/>
      <rect x="-78" y="-20" width="12" height="40" rx="3"/>
      <rect x="79" y="-26" width="16" height="52" rx="4"/>
      <rect x="66" y="-20" width="12" height="40" rx="3"/>
    </g>`
}

function kettlebell(x: number, y: number, c: string): string {
  return `
    <g transform="translate(${x} ${y})" fill="none" stroke="${c}" stroke-width="9">
      <path d="M -16 -18 a 16 16 0 0 1 32 0" />
      <circle cx="0" cy="16" r="26" fill="${c}" stroke="none"/>
    </g>`
}

function rack(x: number, y: number, c: string): string {
  return `
    <g transform="translate(${x} ${y})" stroke="${c}" stroke-width="10" fill="none" stroke-linecap="round">
      <line x1="-42" y1="-55" x2="-42" y2="55"/>
      <line x1="42" y1="-55" x2="42" y2="55"/>
      <line x1="-42" y1="-30" x2="42" y2="-30"/>
      <line x1="-56" y1="55" x2="-28" y2="55"/>
      <line x1="28" y1="55" x2="56" y2="55"/>
    </g>`
}

const ICONS = [barbell, kettlebell, rack]

export function gymImage(seed: string, width = 800, height = 560): string {
  const h = hash(seed)
  const [c1, c2] = GYM_PALETTES[h % GYM_PALETTES.length]
  const icon = ICONS[(h >>> 3) % ICONS.length]
  const accent = `rgba(255,255,255,0.10)`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/>
        <stop offset="1" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#g)"/>
    <rect x="0" y="${height - 90}" width="${width}" height="90" fill="rgba(0,0,0,0.18)"/>
    <g opacity="0.35">
      ${icon(width * 0.32, height * 0.44, accent)}
      ${icon(width * 0.72, height * 0.6, accent)}
    </g>
    <g opacity="0.9">
      ${icon(width * 0.5, height * 0.46, 'rgba(255,255,255,0.85)')}
    </g>
  </svg>`
  return svgToDataUri(svg)
}

const AVATAR_COLORS = ['#FF385C', '#0ea5e9', '#f59e0b', '#10b981', '#8b5cf6', '#ef4444', '#0284c7']

export function avatar(seed: string, initials: string): string {
  const h = hash(seed)
  const color = AVATAR_COLORS[h % AVATAR_COLORS.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" rx="48" fill="${color}"/>
    <text x="48" y="62" font-family="system-ui, sans-serif" font-size="40" font-weight="700"
      fill="#fff" text-anchor="middle">${initials}</text>
  </svg>`
  return svgToDataUri(svg)
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase()
}
