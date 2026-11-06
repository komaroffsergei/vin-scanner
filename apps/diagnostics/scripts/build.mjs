import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { build } from 'vite';

const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const buildId = process.env.BUILD_ID || commit.slice(0, 12) + '-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14);
const base = '/vin-scanner/releases/' + buildId + '/';
const resources = JSON.parse(readFileSync('assets-manifest.json', 'utf8')).resources;
const fixtures = JSON.parse(readFileSync('fixtures/manifest.json', 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const item of [...resources, ...fixtures.cases.map(item => ({ path: item.file, sha256: item.sha256 }))]) {
  if (hash(readFileSync('public/assets/' + item.path)) !== item.sha256) throw new Error('Asset integrity mismatch: ' + item.path);
}
writeFileSync('src/build-info.json', JSON.stringify({ buildId, commit, base }, null, 2) + '\n');
process.env.DIAGNOSTICS_BASE = base;
await build();
const emitted = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.name !== 'assets-manifest.json') {
      const name = path.relative('dist/assets', target).replaceAll(path.sep, '/');
      const bytes = readFileSync(target); const pinned = resources.find(item => item.path === name);
      emitted.push({ ...(pinned || { source: 'diagnostics build / ' + commit, version: buildId, license: name.startsWith('fixtures/') || name.endsWith('.zip') ? 'Synthetic test data' : 'AGPL-3.0-only; third-party notices preserved' }), path: name, bytes: bytes.length, sha256: hash(bytes) });
    }
  }
}
collect('dist/assets');
writeFileSync('dist/assets/assets-manifest.json', JSON.stringify({ schemaVersion: 1, buildId, commit, resources: emitted }, null, 2) + '\n');
writeFileSync('dist/build-info.json', readFileSync('src/build-info.json'));
console.log(JSON.stringify({ buildId, base }));
