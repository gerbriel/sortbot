// Rasterises the Arcadian "A" mark (the glyph from public/favicon.svg) into the
// source images @capacitor/assets reads. Run by hand from the repo root:
//   node assets/make-sources.mjs && npm run assets:generate
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

async function write(name, input, { alpha }) {
  let img = sharp(input)
  if (!alpha) img = img.flatten({ background: WHITE }).removeAlpha()
  await img.png({ compressionLevel: 9, palette: true }).toFile(join(here, name))
  const meta = await sharp(join(here, name)).metadata()
  console.log(`${name}: ${meta.width}x${meta.height}, channels ${meta.channels}`)
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
