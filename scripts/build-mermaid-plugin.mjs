import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginDir = resolve(root, 'plugin-packages', 'mermaid-editor');
const output = resolve(pluginDir, 'mermaid.bundle.js');

const result = await build({
  entryPoints: [resolve(pluginDir, 'browser-entry.js')],
  outfile: output,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome110'],
  minify: true,
  legalComments: 'none',
  splitting: false,
  logLevel: 'warning',
  metafile: true
});

const packageDirs = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  const normalized = input.replaceAll('\\', '/');
  const marker = 'node_modules/';
  const at = normalized.lastIndexOf(marker);
  if (at < 0) continue;
  const after = normalized.slice(at + marker.length).split('/');
  const packageName = after[0].startsWith('@') ? after.slice(0, 2).join('/') : after[0];
  packageDirs.add(resolve(root, normalized.slice(0, at + marker.length), packageName));
}
const notices = ['Third-party notices for the bundled Mermaid editor', ''];
for (const directory of [...packageDirs].sort()) {
  const metadata = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
  notices.push(`===== ${metadata.name}@${metadata.version} (${metadata.license ?? 'license in package'}) =====`);
  const files = await readdir(directory);
  const licenseName = files.find((name) => /^(?:LICENSE|LICENCE|COPYING)(?:\..*)?$/i.test(name));
  if (licenseName) notices.push((await readFile(resolve(directory, licenseName), 'utf8')).trim());
  else if (metadata.name === 'fastdom') {
    const readme = await readFile(resolve(directory, 'README.md'), 'utf8');
    notices.push(readme.slice(readme.indexOf('(The MIT License)')).trim());
  } else notices.push(`License identifier: ${JSON.stringify(metadata.license ?? 'unspecified')}`);
  notices.push('');
}
await writeFile(resolve(pluginDir, 'THIRD_PARTY_NOTICES.txt'), `${notices.join('\n')}\n`);

const manifestPath = resolve(pluginDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const files = ['index.js', 'office-drawing.js', 'mermaid.bundle.js', 'README.md', 'THIRD_PARTY_NOTICES.txt'];
manifest.fileHashes = Object.fromEntries(await Promise.all(files.map(async (name) => [
  name,
  createHash('sha256').update(await readFile(resolve(pluginDir, name))).digest('hex')
])));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const size = (await readFile(output)).byteLength;
if (size > 8 * 1024 * 1024) throw new Error(`Mermaid bundle exceeds 8 MiB: ${size}`);
process.stdout.write(`Mermaid browser bundle: ${size} bytes\n`);
