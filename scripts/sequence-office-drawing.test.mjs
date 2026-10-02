import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const identity = { inverse() { return this; } };
const fixture = `<svg data-box="0,0,300,300" xmlns="http://www.w3.org/2000/svg">
<defs><marker id="test-sequencenumber"><circle r="6" style="fill:black"/></marker><marker id="arrowhead"><path d="M0 0 L10 5 L0 10Z"/></marker></defs>
<rect class="rect" data-box="0,60,300,200" style="fill:rgba(0,255,0,0.1);stroke:none"/>
<g><rect data-box="70,0,60,40" rx="3" style="fill:#eeeeff;stroke:#8888aa;stroke-width:1"/><text class="actor" data-box="80,10,40,20" style="fill:black;font-size:16px">利用者</text></g>
<g><rect data-box="170,0,60,40" rx="3" style="fill:#eeeeff;stroke:#8888aa;stroke-width:1"/><text class="actor" data-box="180,10,40,20" style="fill:black;font-size:16px">サーバー</text></g>
<line class="actor-line" data-id="A" x1="100" y1="40" x2="100" y2="280" data-box="100,40,0,240" style="stroke:#999999;stroke-width:1;stroke-dasharray:5,5"/>
<line class="actor-line" data-id="B" x1="200" y1="40" x2="200" y2="280" data-box="200,40,0,240" style="stroke:#999999;stroke-width:1;stroke-dasharray:5,5"/>
<rect class="activation0" data-box="195,100,10,60" style="fill:white;stroke:black;stroke-width:1"/>
<line data-et="message" data-id="i1" data-from="A" data-to="B" x1="100" y1="120" x2="195" y2="120" marker-end="url(#test-arrowhead)" style="stroke:black;stroke-width:2;stroke-dasharray:0"/>
<line data-et="message" data-id="i2" x1="195" y1="140" x2="100" y2="140" marker-end="url(#test-filled-head)" style="stroke:black;stroke-width:2;stroke-dasharray:3,3"/>
<line data-et="message" data-id="i3" data-from="A" data-to="B" x1="100" y1="180" x2="200" y2="180" marker-end="url(#test-crosshead)" style="stroke:black;stroke-width:2"/>
<path data-et="message" data-id="i4" data-from="A" data-to="A" data-box="100,200,40,20" d="M100 200 C160 190 160 230 100 220" marker-end="url(#test-arrowhead)" style="fill:none;stroke:black;stroke-width:2"/>
<g><rect class="note" data-box="30,65,100,35" style="fill:#ffffaa;stroke:black;stroke-width:1"/><text class="noteText" data-box="35,70,90,25" style="fill:#333333;font-size:16px"><tspan>日本語ノート</tspan><tspan>2行目</tspan></text></g>
<line class="loopLine" x1="0" y1="60" x2="300" y2="60" style="stroke:black;stroke-width:1"/>
<line x1="90" y1="120" x2="90" y2="120" marker-start="url(#test-sequencenumber)" style="stroke:none;stroke-width:0"/>
<text class="sequenceNumber" data-box="87,116,6,8" style="fill:white;font-size:12px">1</text>
<g data-et="participant" data-type="database"><g class="actor"><path data-box="250,0,30,30" d="M250 5 a15 5 0 0 0 30 0 a15 5 0 0 0 -30 0 l0 20" style="fill:#eeeeff;stroke:#8888aa;stroke-width:1"/></g></g>
</svg>`;

describe('sequence SVG to editable Office drawing', () => {
  let svg;
  beforeEach(() => {
    document.body.innerHTML = fixture;
    svg = document.querySelector('svg');
    vi.stubGlobal('DOMPoint', class {
      constructor(x, y) { this.x = x; this.y = y; }
      matrixTransform() { return this; }
    });
    Object.defineProperty(svg, 'viewBox', { value: { baseVal: { x: 0, y: 0, width: 300, height: 300 } } });
    for (const element of [svg, ...svg.querySelectorAll('*')]) {
      Object.defineProperty(element, 'getScreenCTM', { value: () => identity });
      const [x = 0, y = 0, w = 0, h = 0] = (element.getAttribute('data-box') || '').split(',').map(Number);
      element.getBoundingClientRect = () => ({ x, y, width: w, height: h, left: x, top: y, right: x + w, bottom: y + h, toJSON() {} });
      if (element.tagName.toLowerCase() === 'line') {
        for (const attribute of ['x1', 'x2', 'y1', 'y2']) Object.defineProperty(element, attribute, { value: { baseVal: { value: Number(element.getAttribute(attribute)) } } });
      }
      if (element.tagName.toLowerCase() === 'path') {
        Object.defineProperty(element, 'getTotalLength', { value: () => 100 });
        Object.defineProperty(element, 'getPointAtLength', { value: (length) => ({ x: 100 + 40 * Math.sin(Math.PI * length / 100), y: 200 + length / 5 }) });
      }
    }
    window.markinkMermaid = { mermaidAPI: { getDiagramFromText: async () => ({ db: {
      getActors: () => new Map([['A', { name: 'A' }], ['B', { name: 'B' }]]),
      getMessages: () => [{ id: 1, from: 'A', to: 'B' }, { id: 2, from: 'B', to: 'A' }, { id: 3, from: 'A', to: 'B' }, { id: 4, from: 'A', to: 'A' }]
    } }) } };
    new Function(readFileSync(resolve('plugin-packages/mermaid-editor/sequence-office-drawing.js'), 'utf8'))();
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  const drawing = async () => JSON.parse(await window.markinkSequenceOfficeDrawing('sequenceDiagram', svg));

  it('parses the bundled sequence example with the real Mermaid parser', async () => {
    const mermaid = (await import('mermaid')).default;
    const example = readFileSync(resolve('plugin-packages/mermaid-editor/sequence-example.md'), 'utf8');
    const source = example.match(/```mermaid\n([\s\S]*?)\n```/)[1];
    await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'sequence' });
  });

  it('keeps solid, dotted, asynchronous, and cross messages distinct and connected', async () => {
    const data = await drawing();
    const solid = data.lines.find((edge) => edge.points[0][1] === 120 && edge.endNode);
    const dotted = data.lines.find((edge) => edge.points[0][1] === 140);
    const cross = data.lines.find((edge) => edge.points[0][1] === 180);
    expect(solid).toMatchObject({ dash: 'solid', endArrow: 'triangle', startNode: 'sequence-life-A', endNode: 'sequence-activation-0' });
    expect(dotted).toMatchObject({ dash: 'dot', endArrow: 'arrow', startNode: 'sequence-activation-0', endNode: 'sequence-life-A' });
    expect(data.shapes.find((shape) => shape.nodeId === solid.endNode)).toMatchObject({ pathClosed: true });
    expect(cross.endCrossSites).toHaveLength(4);
    const target = data.shapes.find((shape) => shape.nodeId === cross.endNode);
    expect(cross.endCrossSites.map((index) => target.connectionSites[index])).toEqual([[196,176],[204,184],[196,184],[204,176]]);
  });

  it('keeps self messages as one open path and does not import marker definitions', async () => {
    const data = await drawing();
    const self = data.shapes.filter((shape) => shape.endArrow === 'triangle');
    expect(self).toHaveLength(1);
    expect(self[0]).toMatchObject({ kind: 'freeform', pathClosed: false, fill: 'none' });
    expect(self[0].points[0]).toEqual([100,200]);
    expect(self[0].points.at(-1)[0]).toBeCloseTo(100);
    expect(self[0].points.at(-1)[1]).toBe(220);
    expect(data.shapes.some((shape) => shape.w === 0)).toBe(false);
  });

  it('keeps labels once, preserves multiline notes, font size, background opacity and number badges', async () => {
    const data = await drawing();
    expect(data.shapes.filter((shape) => shape.label === '利用者')).toHaveLength(1);
    expect(data.shapes.find((shape) => shape.label.startsWith('日本語ノート'))).toMatchObject({ label: '日本語ノート\n2行目', fontSize: 16 });
    expect(data.shapes.find((shape) => shape.layer === 'background')).toMatchObject({ fill: '#00FF00', fillOpacity: 0.1 });
    expect(data.shapes.some((shape) => shape.kind === 'ellipse' && shape.w === 12)).toBe(true);
    expect(data.shapes.find((shape) => shape.kind === 'can')).toMatchObject({ fill: '#EEEEFF', stroke: '#8888AA' });
    expect(data.texts.filter((text) => text.label === '利用者')).toHaveLength(0);
  });

  it.skipIf(process.platform !== 'win32')('generates Office XML with editable open paths, connected messages and correct text/color without touching the clipboard', async () => {
    const data = await drawing();
    const original = readFileSync(resolve('src-tauri/src/office_copy.ps1'), 'utf8');
    const nativeStart = original.indexOf("Add-Type -TypeDefinition @'");
    expect(nativeStart).toBeGreaterThan(0);
    const inspect = `
$stream.Position = 0
$inspect = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Read, $true)
$entry = $inspect.GetEntry('clipboard/drawings/drawing1.xml')
$reader = [IO.StreamReader]::new($entry.Open())
[Console]::Out.Write($reader.ReadToEnd())
$reader.Dispose()
$inspect.Dispose()
`;
    const script = '[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)\n' + original.slice(0, nativeStart) + inspect;
    const directory = mkdtempSync(join(tmpdir(), 'markink-office-check-'));
    const scriptPath = join(directory, 'generate.ps1');
    let xml;
    try {
      writeFileSync(scriptPath, '\uFEFF' + script);
      xml = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath], { input: JSON.stringify(data), encoding: 'utf8', timeout: 30000 });
    } finally {
      unlinkSync(scriptPath);
      rmdirSync(directory);
    }
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    expect(doc.querySelector('parsererror')).toBeNull();
    const ns = 'http://schemas.openxmlformats.org/drawingml/2006/main';
    const shapes = [...doc.getElementsByTagNameNS(ns, 'sp')];
    const lifeIndex = data.shapes.findIndex((shape) => shape.nodeId === 'sequence-life-A');
    const selfIndex = data.shapes.findIndex((shape) => shape.endArrow === 'triangle');
    for (const index of [lifeIndex, selfIndex]) {
      const shape = shapes.find(node => node.getElementsByTagNameNS(ns, 'cNvPr')[0]?.getAttribute('id') === String(index + 2));
      expect(shape.getElementsByTagNameNS(ns, 'close')).toHaveLength(0);
    }
    const allIds = new Set([...doc.getElementsByTagNameNS(ns, 'cNvPr')].map(node => node.getAttribute('id')));
    for (const connection of [...doc.getElementsByTagNameNS(ns, 'stCxn'), ...doc.getElementsByTagNameNS(ns, 'endCxn')]) expect(allIds.has(connection.getAttribute('id'))).toBe(true);
    expect(doc.getElementsByTagNameNS(ns, 'stCxn').length).toBeGreaterThanOrEqual(3);
    expect([...doc.getElementsByTagNameNS(ns, 'alpha')].some(node => node.getAttribute('val') === '10000')).toBe(true);
    expect([...doc.getElementsByTagNameNS(ns, 'tailEnd')].map(node => node.getAttribute('type'))).toEqual(expect.arrayContaining(['triangle', 'arrow']));
    expect(xml).toContain('日本語ノート');
    expect(xml).toContain('2行目');
    expect(xml).toContain('sz="1200"');
  }, 40000);
});
