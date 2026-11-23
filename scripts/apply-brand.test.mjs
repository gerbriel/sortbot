// @vitest-environment node
/**
 * scripts/apply-brand.mjs against fixture copies of the real static files:
 * a rename rewrites every anchored spot, leaves identifiers alone, is a no-op
 * on a second run, and --check reports drift without writing.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(REPO, 'scripts/apply-brand.mjs');
const FILES = [
  'index.html',
  'public/site.webmanifest',
  'public/beta.html',
  'capacitor.config.ts',
  'ios/App/App/Info.plist',
  'android/app/src/main/res/values/strings.xml',
  '.github/workflows/ci.yml',
  '.github/workflows/uptime.yml',
  '.github/workflows/deploy.yml',
];

const NEXT = {
  name: 'Nutkin & Co',
  tagline: 'Nutkin & Co turns photos into listings.',
  landingTitle: 'Nutkin & Co: photos to listings',
  mark: 'N',
};

let root;
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const run = (...extra) => {
  try {
    return { code: 0, out: execFileSync('node', [SCRIPT, '--root', root, ...extra], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) };
  }
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'apply-brand-'));
  for (const rel of FILES) {
    if (!existsSync(join(REPO, rel))) continue;
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    copyFileSync(join(REPO, rel), join(root, rel));
  }
  writeFileSync(join(root, 'brand.json'), JSON.stringify(NEXT));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('apply-brand', () => {
  it('--check reports drift and writes nothing', () => {
    const before = read('index.html');
    const { code, out } = run('--check');
    expect(code).toBe(1);
    expect(out).toContain('stale');
    expect(read('index.html')).toBe(before);
  });

  it('rewrites every anchored spot from brand.json', () => {
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toMatch(/updated \d+ file\(s\)/);

    const html = read('index.html');
    expect(html).toContain('<title>Nutkin &amp; Co</title>');
    expect(html).toContain('<meta name="description" content="Nutkin &amp; Co turns photos into listings." />');
    expect(html).toContain('<meta property="og:site_name" content="Nutkin &amp; Co" />');
    expect(html).toContain('<meta property="og:title" content="Nutkin &amp; Co: photos to listings" />');
    expect(html).toContain('<meta property="og:description" content="Nutkin &amp; Co turns photos into listings." />');
    expect(html).toContain('<meta property="og:image:alt" content="The Nutkin &amp; Co logo: a black N tile beside the word Nutkin &amp; Co." />');
    expect(html).toContain('<meta name="twitter:title" content="Nutkin &amp; Co: photos to listings" />');
    expect(html).toContain('<meta name="twitter:description" content="Nutkin &amp; Co turns photos into listings." />');
    // Identifiers stay.
    expect(html).toContain('<meta property="og:url" content="https://arcadian.ltd/" />');
    expect(html).toContain('<meta property="og:image" content="https://arcadian.ltd/og.png" />');

    const manifest = JSON.parse(read('public/site.webmanifest'));
    expect(manifest.name).toBe('Nutkin & Co');
    expect(manifest.short_name).toBe('Nutkin & Co');

    const beta = read('public/beta.html');
    expect(beta).toContain('<title>Nutkin &amp; Co</title>');
    expect(beta).toContain('<a href="./">Nutkin &amp; Co</a>');

    const cap = read('capacitor.config.ts');
    expect(cap).toContain("appName: 'Nutkin & Co',");
    expect(cap).toContain("appId: 'ltd.arcadian.app',");

    const plist = read('ios/App/App/Info.plist');
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Nutkin &amp; Co<\/string>/);
    expect(plist).toMatch(/<key>CFBundleName<\/key>\s*<string>\$\(PRODUCT_NAME\)<\/string>/);
    expect(plist).toContain('<string>Nutkin &amp; Co uses the camera to photograph items for your listings.</string>');
    expect(plist).toContain('<string>Nutkin &amp; Co turns your dictated listing description into text.</string>');

    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain('<string name="app_name">Nutkin &amp; Co</string>');
    expect(strings).toContain('<string name="title_activity_main">Nutkin &amp; Co</string>');
    expect(strings).toContain('<string name="package_name">ltd.arcadian.app</string>');

    expect(read('.github/workflows/ci.yml')).toContain("grep -q '<title>Nutkin &amp; Co</title>' dist/index.html");
    expect(read('.github/workflows/uptime.yml')).toContain("EXPECTED_TITLE: '<title>Nutkin &amp; Co</title>'");
    expect(read('.github/workflows/uptime.yml')).toContain('SITE: https://arcadian.ltd/');
  });

  it('is idempotent: a second run changes nothing', () => {
    const snapshot = FILES.filter(f => existsSync(join(root, f))).map(read);
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('all static files already say "Nutkin & Co"');
    expect(FILES.filter(f => existsSync(join(root, f))).map(read)).toEqual(snapshot);
    expect(run('--check').code).toBe(0);
  });

  it('the real tree is in sync with brand.json', () => {
    const { code, out } = (() => {
      try {
        return { code: 0, out: execFileSync('node', [SCRIPT, '--check'], { encoding: 'utf8' }) };
      } catch (e) {
        return { code: e.status, out: String(e.stdout) };
      }
    })();
    expect(out).not.toContain('stale');
    expect(code).toBe(0);
  });
});
