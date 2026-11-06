import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { computeCheckDigit } from '../../../packages/vin-scanner/src/core/vin.js';

const output = 'fixtures/images';
await mkdir(output, { recursive: true });
const font = await readFile('fixtures/DejaVuSansMono-Bold.ttf');
const hash = data => createHash('sha256').update(data).digest('hex');
let state = 0x77107731;
const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
const alphabet = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const choose = chars => chars[Math.floor(random() * chars.length)];
const cases = [];
for (let index = 0; index < 4; index++) {
  let vin = ['1HG', 'JHM', 'WVW', 'XTA'][index] + Array.from({ length: 5 }, () => choose(alphabet)).join('') + '0' + choose('ABCDEFGHJKLMNPRSTVWXY123456789') + choose(alphabet) + Array.from({ length: 6 }, () => choose('0123456789')).join('');
  const digit = computeCheckDigit(vin);
  vin = vin.slice(0, 8) + (index < 2 ? digit : String((Number(digit === 'X' ? 0 : digit) + 1) % 10)) + vin.slice(9);
  for (const variant of ['clean', 'noise', 'stretch', 'combined']) cases.push({
    caseId: `vin${index + 1}-${variant}`, expected: vin, width: 1280, height: 240,
    noiseSigma: ['noise', 'combined'].includes(variant) ? [8, 16, 24, 32][index] : 0,
    stretchX: ['stretch', 'combined'].includes(variant) ? [0.65, 0.85, 1.25, 1.6][index] : 1,
    seed: Math.floor(random() * 4294967296), file: `fixtures/vin${index + 1}-${variant}.png`,
  });
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.evaluate(async base64 => {
    const font = new FontFace('FixtureMono', Uint8Array.from(atob(base64), character => character.charCodeAt(0)));
    document.fonts.add(await font.load());
  }, font.toString('base64'));
  for (const fixture of cases) {
    const dataUrl = await page.evaluate(fixture => {
      let state = fixture.seed;
      const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return ((state >>> 0) + 0.5) / 4294967296; };
      const canvas = document.createElement('canvas'); canvas.width = fixture.width; canvas.height = fixture.height;
      const context = canvas.getContext('2d');
      context.fillStyle = '#f5f5f2'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.save(); context.translate(640, 120); context.scale(fixture.stretchX, 1);
      context.font = '64px FixtureMono'; context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#151515'; context.fillText(fixture.expected, 0, 0); context.restore();
      if (fixture.noiseSigma) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        for (let offset = 0; offset < pixels.data.length; offset += 4) {
          const noise = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()) * fixture.noiseSigma;
          for (let channel = 0; channel < 3; channel++) pixels.data[offset + channel] += noise;
        }
        context.putImageData(pixels, 0, 0);
      }
      return canvas.toDataURL('image/png');
    }, fixture);
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
    fixture.sha256 = hash(bytes); fixture.bytes = bytes.length;
    await writeFile(output + '/' + fixture.caseId + '.png', bytes);
  }
} finally { await browser.close(); }
const manifest = { suiteId: 'vin-synthetic-v1', seed: '0x77107731', font: { name: 'DejaVu Sans Mono Bold', sha256: hash(font), license: 'DejaVu Fonts / Bitstream Vera' }, cases };
const text = JSON.stringify(manifest, null, 2) + '\n';
await writeFile('fixtures/manifest.json', text);
console.log(JSON.stringify({ images: cases.length, bytes: cases.reduce((sum, item) => sum + item.bytes, 0) }));
