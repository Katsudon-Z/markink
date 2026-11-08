import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plugin = resolve(root, 'plugin-packages/mermaid-wysiwyg');
const shared = resolve(root, 'plugin-packages/mermaid-editor');
const vendor = resolve(root, 'vendor/mermaid-wysiwyg');
await build({
  entryPoints: [resolve(plugin, 'browser-entry.js')],
  outfile: resolve(plugin, 'wysiwyg.bundle.js'),
  bundle: true, format: 'iife', platform: 'browser', target: ['chrome110'],
  minify: true, legalComments: 'none',
  alias: { '@inkeep/mermaid-wysiwyg-core': resolve(vendor, 'packages/core/src/index.ts') }
});
// Share the existing rendering, clipboard and optimistic document-edit routines.
// The resulting ZIP has no dependency on another installed plugin.
const existing = await readFile(resolve(shared, 'index.js'), 'utf8');
const boundary = existing.indexOf('self.markinkPlugin =');
if (boundary < 0) throw new Error('Shared Mermaid runtime entry was not found');
const editorStart = existing.indexOf('function editorHtml(');
const rendererStart = existing.indexOf('function renderHtml(');
if (editorStart < 0 || rendererStart <= editorStart || rendererStart >= boundary) throw new Error('Shared Mermaid runtime structure changed');
const runtime = (existing.slice(0, editorStart) + existing.slice(rendererStart, boundary))
  .replace("existing ? 'Mermaid図を編集' : 'Mermaid図を作成'", "existing ? 'Mermaid図をビジュアル編集' : 'Mermaid図をビジュアル作成'");
await writeFile(resolve(plugin, 'index.js'), runtime + await readFile(resolve(plugin, 'worker-entry.js'), 'utf8'));
const resources = ['mermaid.bundle.js', 'office-drawing.js', 'sequence-office-drawing.js',
  'state-office-drawing.js', 'pie-office-drawing.js', 'architecture-office-drawing.js'];
for (const name of resources) await copyFile(resolve(shared, name), resolve(plugin, name));
await writeFile(resolve(plugin, 'THIRD_PARTY_NOTICES.txt'),
  await readFile(resolve(shared, 'THIRD_PARTY_NOTICES.txt'), 'utf8')
  + '\n===== mermaid-wysiwyg, Inkeep, source commit 0d211031f47ac6b493ce091a2fd69795e3ff7a32 =====\n'
  + await readFile(resolve(vendor, 'LICENSE'), 'utf8')
  + '\nLocal integration changes: selectionBoundary, commitActiveEdit, stale-render guard, preserve start arrows in flowchart edits.\n');
const manifestPath = resolve(plugin, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const files = ['index.js', 'visual-editor.html', 'visual-editor.js', 'wysiwyg.bundle.js',
  'README.md', 'THIRD_PARTY_NOTICES.txt', ...resources];
manifest.fileHashes = Object.fromEntries(await Promise.all(files.map(async (name) => [name,
  createHash('sha256').update(await readFile(resolve(plugin, name))).digest('hex')])));
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('Built independent Mermaid WYSIWYG plugin resources');
