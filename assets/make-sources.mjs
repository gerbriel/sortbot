// Rasterises the brand mark (the glyph from public/favicon.svg, traced from
// Outfit by assets/trace-glyph.py) into the source images @capacitor/assets
// reads, plus the web images served from public/. The OG wordmark text is the
// "name" field of brand.json at the repo root. Normally run as one step of
//   BRAND_PYTHON=/path/to/fontvenv/bin/python npm run brand:assets
// (trace the mark, this script, @capacitor/assets, revert AndroidManifest.xml),
// or on its own from the repo root:
//   node assets/make-sources.mjs && npm run assets:generate
//
// Outputs:
//   assets/  icon-only, icon-foreground, icon-background, splash, splash-dark
//            (inputs to @capacitor/assets)
//   public/  og.png (1200x630 Open Graph / Twitter card), apple-touch-icon.png
//            (180, opaque), icon-192.png and icon-512.png (site.webmanifest)
//
// The og.png wordmark is set in Outfit 500, the one brand font, from the
// self-hosted file src/assets/fonts/outfit-latin-300-700.woff2. It is drawn
// with sharp's text input (Pango), which registers that file through its
// `fontfile` option, so the result does not depend on fonts installed on the
// machine. librsvg ignores @font-face, so an <text> element in the SVG would
// silently fall back to a system face. A "Fontconfig error: Cannot load default
// config file" line on stderr is harmless. Output is deterministic for a given
// sharp version (sharp is pinned in package-lock.json).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const favicon = readFileSync(join(here, '..', 'public', 'favicon.svg'), 'utf8')
const brand = JSON.parse(readFileSync(join(here, '..', 'brand.json'), 'utf8'))
if (typeof brand.name !== 'string' || !brand.name) throw new Error('brand.json has no "name"')

// The favicon is a black rounded tile with the mark path in white. Only the path
// is the mark; take its d attribute so the sources follow the favicon.
const paths = [...favicon.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 1) throw new Error(`expected one <path> in favicon.svg, found ${paths.length}`)
const d = paths[0]

// Bounding box of the mark in favicon units (viewBox 0 0 64 64). The path uses
// only absolute M, L, H, V, Q and Z commands (what trace-glyph.py writes for a
// TrueType outline); anything else is rejected. A quadratic segment adds its
// end point plus its true extremum on each axis, not its control point.
const xs = [], ys = []
let cx = 0, cy = 0
const quadExtrema = (p0, p1, p2) => {
  const den = p0 - 2 * p1 + p2
  if (den === 0) return []
  const t = (p0 - p1) / den
  return t > 0 && t < 1 ? [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2] : []
}
for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
  const n = (args.match(/-?\d+(\.\d+)?/g) || []).map(Number)
  if (cmd === 'M' || cmd === 'L') for (let i = 0; i < n.length; i += 2) { cx = n[i]; cy = n[i + 1]; xs.push(cx); ys.push(cy) }
  else if (cmd === 'H') for (const v of n) { cx = v; xs.push(cx); ys.push(cy) }
  else if (cmd === 'V') for (const v of n) { cy = v; xs.push(cx); ys.push(cy) }
  else if (cmd === 'Q') for (let i = 0; i < n.length; i += 4) {
    const [qx, qy, ex, ey] = n.slice(i, i + 4)
    xs.push(...quadExtrema(cx, qx, ex), ex)
    ys.push(...quadExtrema(cy, qy, ey), ey)
    cx = ex; cy = ey
  }
  else if (cmd !== 'Z') throw new Error(`unsupported path command ${cmd} in favicon.svg`)
}
const minX = Math.min(...xs), maxX = Math.max(...xs)
const minY = Math.min(...ys), maxY = Math.max(...ys)
const markW = maxX - minX, markH = maxY - minY

const WHITE = '#ffffff'
const BLACK = '#000000'

// canvas: square size in px; markSize: width of the mark in px; bg: fill or null.
function svg({ canvas, markSize, fg, bg }) {
  const s = markSize / Math.max(markW, markH)
  const tx = (canvas - markW * s) / 2 - minX * s
  const ty = (canvas - markH * s) / 2 - minY * s
  const rect = bg ? `<rect width="${canvas}" height="${canvas}" fill="${bg}"/>` : ''
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}">` +
      rect +
      `<path transform="translate(${tx} ${ty}) scale(${s})" d="${d}" fill="${fg}"/></svg>`,
  )
}

async function write(name, input, { alpha, dir = here }) {
  let img = sharp(input)
  if (!alpha) img = img.flatten({ background: WHITE }).removeAlpha()
  const out = join(dir, name)
  await img.png({ compressionLevel: 9, palette: true }).toFile(out)
  const meta = await sharp(out).metadata()
  console.log(`${out.slice(join(here, '..').length + 1)}: ${meta.width}x${meta.height}, channels ${meta.channels}`)
}

const publicDir = join(here, '..', 'public')
const fontFile = join(here, '..', 'src', 'assets', 'fonts', 'outfit-latin-300-700.woff2')

// Open Graph card: 1200x630 white, the favicon tile (black rounded square,
// white mark) left of the brand name. The tile rather than the bare glyph: a
// bare black "S" beside a word that starts with "S" reads as "S SQRL".
// The word is trimmed to its ink, whose top is the cap line. Its bottom is not
// the baseline when a letter descends (the tail of the Q in "SQRL"), so the
// composition is centred on the CAP HEIGHT, measured from a rendered "H", and
// the tail hangs below it as it would in running text.
async function og() {
  const W = 1200, H = 630, SIZE = 200, GAP = 56
  // Matches .wordmark in src/index.css: weight 500, letter-spacing -0.03em.
  // Pango letter_spacing is in 1/1024 pt; dpi 72 makes 1 pt = 1 px.
  const spacing = Math.round(-0.03 * SIZE * 1024)
  const render = (text) => sharp({
    text: {
      text: `<span foreground="${BLACK}" font_weight="500" letter_spacing="${spacing}">${text}</span>`,
      fontfile: fontFile,
      font: `Outfit ${SIZE}`,
      dpi: 72,
      rgba: true,
    },
  }).trim().png().toBuffer({ resolveWithObject: true })
  const escaped = brand.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const word = await render(escaped)
  const capH = (await render('H')).info.height
  const wordW = word.info.width
  // The tile is public/favicon.svg itself, rasterised at 1.6x the cap height.
  const markPx = Math.round(capH * 1.6)
  const mark = await sharp(Buffer.from(favicon), { density: (72 * markPx) / 64 })
    .resize(markPx, markPx).png().toBuffer()
  const left = Math.round((W - (markPx + GAP + wordW)) / 2)
  const markTop = Math.round((H - markPx) / 2)
  const wordTop = Math.round((H - capH) / 2)
  const card = await sharp({ create: { width: W, height: H, channels: 4, background: WHITE } })
    .composite([
      { input: mark, left, top: markTop },
      { input: word.data, left: left + markPx + GAP, top: wordTop },
    ])
    .png()
    .toBuffer()
  await write('og.png', card, { alpha: false, dir: publicDir })
}

// iOS / legacy icon: opaque white, mark about 56% of the tile.
await write('icon-only.png', svg({ canvas: 1024, markSize: 576, fg: BLACK, bg: WHITE }), { alpha: false })

// Android adaptive foreground: transparent, mark 50% of the layer. The generated
// mipmap-anydpi-v26 XML insets each layer by 16.7%, so this layer IS the visible
// 72dp icon; 50% keeps the mark (diagonal about 71%) inside a circular mask.
await write('icon-foreground.png', svg({ canvas: 1024, markSize: 512, fg: BLACK, bg: null }), { alpha: true })

// Android adaptive background: plain white.
await write('icon-background.png', svg({ canvas: 1024, markSize: 0, fg: WHITE, bg: WHITE }), { alpha: false })

// Splash screens: 2732 square, mark about 20% of the width.
await write('splash.png', svg({ canvas: 2732, markSize: 546, fg: BLACK, bg: WHITE }), { alpha: false })
await write('splash-dark.png', svg({ canvas: 2732, markSize: 546, fg: WHITE, bg: BLACK }), { alpha: false })

// Web: Open Graph card, Apple touch icon (iOS rejects transparency and rounds
// the corners itself, so opaque white with the mark at about 56%, like
// icon-only), and the two web manifest icons in the same style.
await og()
await write('apple-touch-icon.png', svg({ canvas: 180, markSize: 100, fg: BLACK, bg: WHITE }), { alpha: false, dir: publicDir })
await write('icon-192.png', svg({ canvas: 192, markSize: 108, fg: BLACK, bg: WHITE }), { alpha: false, dir: publicDir })
await write('icon-512.png', svg({ canvas: 512, markSize: 288, fg: BLACK, bg: WHITE }), { alpha: false, dir: publicDir })
