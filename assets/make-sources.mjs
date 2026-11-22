// Rasterises the Arcadian "A" mark (the glyph from public/favicon.svg) into the
// source images @capacitor/assets reads, plus the web images served from
// public/. Run by hand from the repo root:
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

// The favicon is a black rounded tile with the "A" path in white. Only the path
// is the mark; take its d attribute so the sources follow the favicon.
const paths = [...favicon.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((m) => m[1])
if (paths.length !== 1) throw new Error(`expected one <path> in favicon.svg, found ${paths.length}`)
const d = paths[0]

// Bounding box of the mark in favicon units (viewBox 0 0 64 64). The path uses
// only absolute M, L, H, V and Z commands; anything else is rejected.
const xs = [], ys = []
let cx = 0, cy = 0
for (const [, cmd, args] of d.matchAll(/([A-Za-z])([^A-Za-z]*)/g)) {
  const n = (args.match(/-?\d+(\.\d+)?/g) || []).map(Number)
  if (cmd === 'M' || cmd === 'L') for (let i = 0; i < n.length; i += 2) { cx = n[i]; cy = n[i + 1]; xs.push(cx); ys.push(cy) }
  else if (cmd === 'H') for (const v of n) { cx = v; xs.push(cx); ys.push(cy) }
  else if (cmd === 'V') for (const v of n) { cy = v; xs.push(cx); ys.push(cy) }
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
// white "A") left of the word "Arcadian". The tile rather than the bare glyph:
// a bare black "A" beside a word that starts with "A" reads as "A Arcadian".
// The word is trimmed to its ink ("Arcadian" has no descenders, so the box runs
// from the baseline to the ascender of the d) and the tile is centred on it.
async function og() {
  const W = 1200, H = 630, SIZE = 160, GAP = 48
  // Matches .wordmark in src/index.css: weight 500, letter-spacing -0.03em.
  // Pango letter_spacing is in 1/1024 pt; dpi 72 makes 1 pt = 1 px.
  const spacing = Math.round(-0.03 * SIZE * 1024)
  const word = await sharp({
    text: {
      text: `<span foreground="${BLACK}" font_weight="500" letter_spacing="${spacing}">Arcadian</span>`,
      fontfile: fontFile,
      font: `Outfit ${SIZE}`,
      dpi: 72,
      rgba: true,
    },
  }).trim().png().toBuffer({ resolveWithObject: true })
  const wordW = word.info.width, wordH = word.info.height
  // The tile is public/favicon.svg itself, rasterised at 1.6x the word's ink height.
  const markPx = Math.round(wordH * 1.6)
  const mark = await sharp(Buffer.from(favicon), { density: (72 * markPx) / 64 })
    .resize(markPx, markPx).png().toBuffer()
  const left = Math.round((W - (markPx + GAP + wordW)) / 2)
  const markTop = Math.round((H - markPx) / 2)
  const wordTop = Math.round((H - wordH) / 2)
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
