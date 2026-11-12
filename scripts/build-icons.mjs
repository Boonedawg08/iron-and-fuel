// Renders public/icons/icon.svg into the PNG sizes the manifest and iOS need.
// Usage: npm run build:icons   (requires Playwright + Chromium to be available)
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const svg = readFileSync(new URL('../public/icons/icon.svg', import.meta.url), 'utf8');
const square = svg.replace('rx="112"', 'rx="0"'); // full-bleed for maskable + Apple
const out = new URL('../public/icons/', import.meta.url).pathname;

const jobs = [
  { file: 'icon-192.png', size: 192, src: svg, pad: 0, transparent: true },
  { file: 'icon-512.png', size: 512, src: svg, pad: 0, transparent: true },
  { file: 'icon-maskable-512.png', size: 512, src: square, pad: 0.1 },
  { file: 'apple-touch-icon.png', size: 180, src: square, pad: 0 },
];

const browser = await chromium.launch();
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.size, height: j.size } });
  const inner = Math.round(j.size * (1 - 2 * j.pad));
  await page.setContent(
    `<body style="margin:0;display:grid;place-items:center;width:${j.size}px;height:${j.size}px;background:${j.transparent ? 'transparent' : '#0b0d10'}">
       <div style="width:${inner}px;height:${inner}px">${j.src}</div></body>`,
  );
  await page.screenshot({ path: out + j.file, omitBackground: !!j.transparent });
  await page.close();
  console.log('wrote', j.file);
}
await browser.close();
