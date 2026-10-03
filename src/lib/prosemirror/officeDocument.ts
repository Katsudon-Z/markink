import { DOMSerializer, type Node as PMNode } from 'prosemirror-model';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { fixTables, TableMap } from 'prosemirror-tables';
import type { EditorView } from 'prosemirror-view';
import { ipc } from '../ipc';
import { markdownSerializer } from './markdown';
import { exportCodeBlock, hasCodeBlockRenderer } from './codeBlockRenderers';
import { svgOfficeDrawing, imagePng, drawingHtml } from './officeSvg';

export interface OfficeRun { text: string; fontSize: number; fontFamily: string; textColor: string; bold?: boolean; italic?: boolean; underline?: boolean }
export interface OfficeParagraph { runs: OfficeRun[] }
export interface OfficeShape { x: number; y: number; w: number; h: number; kind: string; label: string; points?: number[][]; nodeId?: string; groupId?: string; connectionSites?: number[][]; paragraphs?: OfficeParagraph[]; [key: string]: unknown }
export interface OfficeLine { points: number[][]; startNode?: string; endNode?: string; [key: string]: unknown }
export interface OfficeTable { x: number; y: number; w: number; h: number; columns: number[]; rows: { height: number; cells: Record<string, unknown>[] }[] }
export interface OfficeImage { x: number; y: number; w: number; h: number; png: string }
export interface OfficeDrawing { minX: number; minY: number; width: number; height: number; shapes: OfficeShape[]; lines: OfficeLine[]; texts: OfficeShape[]; tables?: OfficeTable[]; images?: OfficeImage[] }

function selectionDoc(view: EditorView): PMNode {
  if (view.state.selection.empty) throw new Error('コピーする範囲を選択してください');
  const doc = view.state.schema.nodes.doc.create(null, view.state.selection.content().content);
  // A text selection may cut the first/last row or a merged cell. Repair the
  // copied fragment, without changing the source document or adding unselected text.
  const state = EditorState.create({ schema: view.state.schema, doc });
  return fixTables(state)?.doc ?? doc;
}
export function canCopyPng(view: EditorView): boolean {
  const selection = view.state.selection;
  return selection instanceof NodeSelection && (hasCodeBlockRenderer(selection.node) || selection.node.type.name === 'image');
}
export async function copySelectionMarkdown(view: EditorView): Promise<void> {
  await ipc.copyClipboardData('text', markdownSerializer.serialize(selectionDoc(view)));
}
export async function copySelectionPng(view: EditorView): Promise<void> {
  if (!canCopyPng(view)) throw new Error('PNG画像コピーは図形を単独で選択してください');
  const { from } = view.state.selection;
  const node = view.state.doc.nodeAt(from)!;
  const value = hasCodeBlockRenderer(node) ? await exportCodeBlock(view, from, 'png') : await imagePng(findImage(view, from));
  if (!value.startsWith('data:image/png;base64,')) throw new Error('PNG画像のデータが不正です');
  await ipc.copyClipboardData('png', value.slice('data:image/png;base64,'.length));
}
function findImage(view: EditorView, pos: number): HTMLImageElement {
  const element = view.nodeDOM(pos);
  const image = element instanceof HTMLImageElement ? element : element instanceof Element ? element.querySelector('img') : null;
  if (!image) throw new Error('画像の表示が完了していません');
  return image;
}

export async function copySelectionFormatted(view: EditorView): Promise<void> {
  const original = view.state.doc;
  const originalSelection = view.state.selection;
  if (originalSelection instanceof NodeSelection && hasCodeBlockRenderer(originalSelection.node)) {
    const value = await exportCodeBlock(view, originalSelection.from, 'office-drawing');
    if (!view.state.doc.eq(original) || !view.state.selection.eq(originalSelection)) throw new Error('コピーの準備中に文書または選択範囲が変わりました。再度コピーしてください');
    await ipc.copyOfficeDrawing(value);
    return;
  }
  const doc = selectionDoc(view);
  const css = getComputedStyle(view.dom);
  const fontSize = Math.min(200, Math.max(1, parseFloat(css.fontSize) || 16));
  const fontFamily = css.fontFamily.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
  const width = Math.max(320, Math.min(1200, view.dom.clientWidth || 800));
  const drawing: OfficeDrawing = { minX: 0, minY: 0, width, height: 1, shapes: [], lines: [], texts: [], tables: [], images: [] };
  const container = document.createElement('div');
  container.style.cssText = `font-family:${css.fontFamily};font-size:${fontSize}px;color:#0f172a`;
  container.append(DOMSerializer.fromSchema(view.state.schema).serializeFragment(doc.content));
  container.querySelectorAll('.mdn-html-comment').forEach(element=>element.remove());
  const htmlImages = [...container.querySelectorAll('img')];
  const htmlPres = [...container.querySelectorAll('pre')];
  for (const table of container.querySelectorAll('table')) { table.setAttribute('border', '1'); table.style.borderCollapse = 'collapse'; }
  for (const cell of container.querySelectorAll<HTMLElement>('th,td')) { cell.style.cssText = 'border:1px solid #cbd5e1;padding:4px 8px'; }
  let containsDrawing = false;
  doc.descendants(node => {
    if (node.type.name === 'image' || hasCodeBlockRenderer(node)) containsDrawing = true;
  });
  // Offer only document formats for text/tables. Excel otherwise prefers GVML
  // and imports paragraphs as shapes, or cannot paste a DrawingML table.
  if (!containsDrawing) {
    await ipc.copyClipboardData('html', JSON.stringify({ html: container.outerHTML, text: doc.textBetween(0, doc.content.size, '\n', '') }));
    return;
  }
  const renderedBlocks: { pos: number; node: PMNode }[] = [];
  view.state.doc.nodesBetween(originalSelection.from, originalSelection.to, (node, pos) => {
    if (hasCodeBlockRenderer(node)) { renderedBlocks.push({ pos, node }); return false; }
    return true;
  });
  const renderedImages: number[] = [];
  view.state.doc.nodesBetween(originalSelection.from, originalSelection.to, (node, pos) => { if (node.type.name === 'image') renderedImages.push(pos); });
  let diagramIndex = 0, imageIndex = 0, preIndex = 0, y = 0;
  const canvas = document.createElement('canvas').getContext('2d')!;
  const runFor = (text: string, node: PMNode, size = fontSize): OfficeRun => ({ text, fontSize: size, fontFamily: node.marks.some(m=>m.type.name==='code') ? 'Consolas' : fontFamily, textColor: '#0F172A', bold: node.marks.some(m => m.type.name === 'strong'), italic: node.marks.some(m => m.type.name === 'em'), underline: node.marks.some(m => m.type.name === 'link') });
  const paragraphFor = (node: PMNode, size = fontSize): OfficeParagraph[] => {
    const result: OfficeParagraph[] = [{ runs: [] }];
    node.descendants(child => {
      if (child.isText) {
        const rows = (child.text ?? '').split('\n');
        rows.forEach((text,row)=>{
          if(row)result.push({runs:[]});
          for (let i = 0; i < text.length; i += 8000) result[result.length - 1].runs.push(runFor(text.slice(i, i + 8000), child, size));
        });
      } else if (child.type.name === 'hard_break') result.push({ runs: [] });
    });
    return result;
  };
  const textHeight = (paragraphs: OfficeParagraph[], available: number): number => {
    let height = 0;
    for (const paragraph of paragraphs) {
      let used = 0, lines = 1, size = fontSize;
      for (const run of paragraph.runs) {
        size = Math.max(size, run.fontSize);
        canvas.font = `${run.italic ? 'italic ' : ''}${run.bold ? 'bold ' : ''}${run.fontSize}px "${run.fontFamily}"`;
        for (const char of run.text) { const w = canvas.measureText(char).width; if (used + w > available && used > 0) { lines++; used = 0; } used += w; }
      }
      height += lines * size * 1.6;
    }
    return Math.max(fontSize * 1.6, height);
  };
  const addDrawing = (part: OfficeDrawing, prefix: string, indent: number): number => {
    if (![part.minX,part.minY,part.width,part.height].every(Number.isFinite) || part.width <= 0 || part.height <= 0 || !Array.isArray(part.shapes) || !Array.isArray(part.lines) || !Array.isArray(part.texts)) throw new Error('プラグインの図形出力が不正です');
    const scale = Math.min(1, (width - indent) / part.width), dx = indent - part.minX * scale, dy = y - part.minY * scale;
    const point = (p: number[]) => [p[0] * scale + dx, p[1] * scale + dy];
    const shape = (s: OfficeShape): OfficeShape => {
      const out: OfficeShape = { ...s, x: s.x * scale + dx, y: s.y * scale + dy, w: s.w * scale, h: s.h * scale };
      if (s.nodeId) out.nodeId = prefix + s.nodeId;
      if (s.groupId) out.groupId = prefix + s.groupId;
      if (s.points) out.points = s.points.map(point);
      if (s.connectionSites) out.connectionSites = s.connectionSites.map(point);
      for (const key of ['fontSize','strokeWidth']) if (typeof out[key] === 'number') out[key] = Math.max(key === 'fontSize' ? 1 : 0, (out[key] as number) * scale);
      if (Array.isArray(s.dashArray)) out.dashArray = s.dashArray.map(v => Number(v) * scale);
      return out;
    };
    drawing.shapes.push(...part.shapes.map(shape)); drawing.texts.push(...part.texts.map(shape));
    drawing.lines.push(...part.lines.map(line => ({ ...line, points: line.points.map(point), startNode: line.startNode ? prefix + line.startNode : undefined, endNode: line.endNode ? prefix + line.endNode : undefined, strokeWidth: typeof line.strokeWidth === 'number' ? line.strokeWidth * scale : undefined, dashArray: Array.isArray(line.dashArray) ? line.dashArray.map(v => Number(v) * scale) : undefined })));
    return part.height * scale;
  };
  const inlineImages = async (node: PMNode, indent: number) => {
    const nodes: PMNode[] = node.type.name === 'image' ? [node] : []; node.descendants(child => { if (child.type.name === 'image') nodes.push(child); });
    for (const imageNode of nodes) {
      const pos = renderedImages[imageIndex++];
      if (pos === undefined) throw new Error('選択した画像の位置を取得できません');
      const image = findImage(view, pos);
      const svgSource = [String(imageNode.attrs.src),image.src].find(src=>src.startsWith('data:image/svg+xml;'));
      if (svgSource) {
        const part = await svgOfficeDrawing(svgSource);
        const htmlImage = htmlImages[imageIndex - 1];
        htmlImage?.replaceWith(htmlElement(drawingHtml(part)));
        y += addDrawing(part, `image${imageIndex}:`, indent) + 12;
      } else {
        const png = await imagePng(image), w = Math.min(width - indent, image.naturalWidth), h = image.naturalHeight * w / image.naturalWidth;
        drawing.images!.push({ x: indent, y, w, h, png: png.slice('data:image/png;base64,'.length) });
        htmlImages[imageIndex - 1]?.setAttribute('src', png);
        y += h + 12;
      }
    }
  };
  const visit = async (node: PMNode, indent = 0, bullet = ''): Promise<void> => {
    const pre = node.type.name === 'code_block' ? htmlPres[preIndex++] : undefined;
    if (hasCodeBlockRenderer(node)) {
      const originalBlock = renderedBlocks[diagramIndex++];
      if (!originalBlock || originalBlock.node.textContent !== node.textContent) throw new Error('図形はコードブロック全体を選択してください');
      const part = JSON.parse(await exportCodeBlock(view, originalBlock.pos, 'office-drawing')) as OfficeDrawing;
      pre?.replaceWith(htmlElement(drawingHtml(part)));
      y += addDrawing(part, `diagram${diagramIndex}:`, indent) + 12;
    } else if (node.type.name === 'image') {
      await inlineImages(node,indent);
    } else if (node.type.name === 'table') {
      let unsupported = false;
      node.descendants(child => { if (child.type.name === 'code_block') preIndex++; if (child.type.name === 'image' || child.type.name === 'table' || hasCodeBlockRenderer(child)) unsupported = true; });
      if (unsupported) throw new Error('表のセル内の図形・画像・入れ子の表は書式付きコピーに未対応です。表の外へ移動してコピーしてください');
      const map = TableMap.get(node), columns = Array.from({ length: map.width }, () => (width - indent) / map.width);
      const table: OfficeTable = { x: indent, y, w: width - indent, h: 0, columns, rows: [] };
      const heights = Array.from({ length: map.height }, () => fontSize * 1.6 + 12);
      for (let r = 0; r < map.height; r++) {
        const cells: Record<string, unknown>[] = [];
        for (let c = 0; c < map.width; c++) {
          const pos = map.map[r * map.width + c], cell = node.nodeAt(pos)!;
          const rect = map.findCell(pos), anchor = rect.top === r && rect.left === c;
          const paragraphs: OfficeParagraph[] = [];
          if (anchor) cell.forEach(block => paragraphs.push(...paragraphFor(block)));
          if (anchor) {
            const height = textHeight(paragraphs, columns[c] * (rect.right - rect.left) - 16) + 12;
            for (let row = rect.top; row < rect.bottom; row++) heights[row] = Math.max(heights[row], height / (rect.bottom - rect.top));
          }
          cells.push({ label: '', align: 'left', fill: cell.type.name === 'table_header' ? '#F1F5F9' : '#FFFFFF', paragraphs, colspan: anchor ? rect.right - rect.left : 1, rowspan: anchor ? rect.bottom - rect.top : 1, hMerge: c > rect.left, vMerge: r > rect.top });
        }
        table.rows.push({ height: 1, cells });
      }
      table.rows.forEach((row, i) => row.height = heights[i]); table.h = heights.reduce((a,b) => a + b,0);
      drawing.tables!.push(table); y += table.h + 12;
    } else if (node.isTextblock) {
      const size = node.type.name === 'heading' ? Math.min(200,fontSize * (2 - Number(node.attrs.level) * 0.15)) : fontSize;
      const paragraphs = paragraphFor(node, size);
      if (node.type.name === 'code_block') paragraphs.forEach(p=>p.runs.forEach(r=>r.fontFamily='Consolas'));
      if (bullet) paragraphs[0].runs.unshift({ text: bullet, fontFamily, fontSize: size, textColor: '#0F172A' });
      if (node.type.name === 'heading') paragraphs.forEach(p => p.runs.forEach(r => r.bold = true));
      const h = textHeight(paragraphs, width - indent);
      if (node.textContent || bullet || !node.childCount) { drawing.shapes.push({ x: indent, y, w: width - indent, h, kind: 'rectangle', label: '', fill: 'none', stroke: 'none', align: 'left', paragraphs }); y += h + 8; }
      await inlineImages(node, indent);
    } else if (node.type.name === 'horizontal_rule') {
      drawing.lines.push({ points: [[indent,y+4],[width,y+4]], stroke: '#CBD5E1', strokeWidth: 1 }); y += 16;
    } else {
      const children: PMNode[] = []; node.forEach(child => children.push(child));
      for (let i = 0; i < children.length; i++) {
        const list = node.type.name === 'bullet_list' || node.type.name === 'ordered_list';
        const label = node.type.name === 'ordered_list' ? `${Number(node.attrs.order ?? 1) + i}. ` : '• ';
        await visit(children[i], indent + (list || node.type.name === 'blockquote' ? 24 : 0), list ? label : node.type.name === 'list_item' && i > 0 ? '' : bullet);
      }
    }
  };
  await visit(doc);
  drawing.height = Math.max(1,y);
  if (drawing.height >= 100000) throw new Error('コピー範囲が大きすぎます。範囲を分けてコピーしてください');
  if (!view.state.doc.eq(original) || !view.state.selection.eq(originalSelection)) throw new Error('コピーの準備中に文書または選択範囲が変わりました。再度コピーしてください');
  const payload = { ...drawing, clipboardHtml: container.outerHTML, clipboardText: doc.textBetween(0,doc.content.size,'\n','') };
  await ipc.copyOfficeDrawing(JSON.stringify(payload));
}
function htmlElement(html: string): HTMLElement { const div = document.createElement('div'); div.innerHTML = html; return div; }
