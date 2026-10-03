const $ = (id) => document.getElementById(id);
const source = $('source'), status = $('status'), save = $('save');
const error = $('error'), diagram = $('diagram'), menu = $('copy-menu');
const copySurface = $('copy-surface');
const selectDocument = false;
const reportHeight = () => {};
const MAX_TEXT = 100000;
const shapes = [['rect','四角形'],['round','角丸四角'],['stadium','スタジアム'],
  ['subroutine','サブルーチン'],['cylinder','データベース'],['circle','円'],
  ['doublecircle','二重円'],['diamond','ひし形'],['hexagon','六角形'],
  ['lean_r','平行四辺形'],['lean_l','逆平行四辺形'],['trap_b','台形'],
  ['trap_t','逆台形'],['odd','非対称']];
for (const [value, label] of shapes) {
  $('add-shape').add(new Option(label, value));
  $('shape').add(new Option(label, value));
}
source.value = initial;
let editor = null, view = null, applying = false, pendingApply = '';
let renderedSource = '', copySerial = 0, splitPercent = 32;
let currentReadOnly = null;

function showError(cause) {
  error.textContent = String(cause?.message || cause).slice(0, 2000);
  error.style.display = 'block';
}
function selected() {
  const graph = editor?.result.flowchart;
  const id = editor?.selection[0];
  if (!graph || editor.selection.length !== 1) return null;
  return graph.nodes.find((node) => node.entityId === id)
    || graph.edges.find((edge) => edge.entityId === id)
    || graph.subgraphs.find((group) => group.entityId === id) || null;
}
function dispatch(operation) {
  if (!editor?.result.flowchart) return;
  view.commitActiveEdit();
  try {
    const result = editor.dispatch(operation);
    if (!result) throw new Error('この要素は図上で変更できません。記法欄から編集してください');
  } catch (cause) { showError(cause); }
}
function updateHistory() {
  $('undo').disabled = !editor?.canUndo;
  $('redo').disabled = !editor?.canRedo;
  save.disabled = !editor || applying || !editor.code.trim() || editor.code.length > MAX_TEXT;
}
function refreshConnections() {
  const nodes = editor?.result.flowchart?.nodes || [];
  for (const id of ['from','to']) {
    const control = $(id), before = control.value;
    control.replaceChildren(...nodes.map((node) => new Option(node.label + ' (' + node.id + ')', node.id)));
    if (nodes.some((node) => node.id === before)) control.value = before;
  }
  if (!$('to').value || $('to').value === $('from').value) {
    const other = nodes.find((node) => node.id !== $('from').value);
    if (other) $('to').value = other.id;
  }
  $('connect').disabled = nodes.length === 0;
}
function colorHex(value, fallback) {
  const parts = value.match(/[\d.]+/g);
  return parts?.length >= 3 ? '#' + parts.slice(0,3).map((part) => Math.round(Number(part)).toString(16).padStart(2,'0')).join('') : fallback;
}
function refreshProperties() {
  const entity = selected();
  $('fields').hidden = !entity;
  $('hint').hidden = Boolean(entity);
  if (!entity) return;
  const isNode = entity.entityId.startsWith('node:');
  const isEdge = entity.entityId.startsWith('edge:');
  $('selected-title').textContent = isNode ? 'ノード: ' + entity.id : isEdge ? '接続: ' + entity.source + ' → ' + entity.target : 'グループ: ' + entity.id;
  $('label').value = (entity.label ?? entity.title ?? '').replace(/<br\s*\/?>/gi, '\n');
  $('node-fields').hidden = !isNode;
  $('edge-fields').hidden = !isEdge;
  $('delete').disabled = !isNode && !isEdge;
  if (isNode) {
    $('shape').value = entity.shape;
    const elements = [...diagram.querySelectorAll('[data-mw-entity]')];
    const element = elements.find((node) => node.getAttribute('data-mw-entity') === entity.entityId);
    const outline = element?.querySelector('rect,path,polygon,circle,ellipse');
    const text = element?.querySelector('text,tspan');
    if (outline) {
      const css = getComputedStyle(outline);
      $('fill').value = colorHex(css.fill, '#ececff');
      $('stroke').value = colorHex(css.stroke, '#9370db');
    }
    if (text) $('text-color').value = colorHex(getComputedStyle(text).fill, '#333333');
  }
  if (isEdge) { $('line').value = entity.seg.line; $('arrow').value = entity.seg.arrowEnd; }
}
function updateMode() {
  const flowchart = Boolean(editor?.result.flowchart);
  for (const id of ['add','add-shape','connect-tool','direction']) $(id).disabled = !flowchart;
  $('new-edge').hidden = !flowchart;
  if (currentReadOnly !== !flowchart) {
    currentReadOnly = !flowchart;
    view.setReadOnly(currentReadOnly);
  }
  if (!flowchart) {
    view.setTool('select');
    showSource(true);
    status.textContent = 'この図は記法欄で編集できます。図上編集はフローチャートに対応しています';
  }
  const direction = editor?.result.flowchart?.direction;
  if (direction) $('direction').value = direction === 'TB' ? 'TD' : direction;
}
function showSource(visible) {
  $('source-pane').hidden = !visible;
  $('splitter').hidden = !visible;
  $('toggle-source').setAttribute('aria-pressed', String(visible));
  $('toggle-source').textContent = visible ? '記法を隠す' : '記法を表示';
}
function setSplit(percent) {
  const width = $('workspace').getBoundingClientRect().width;
  const maximum = width ? Math.min(65, Math.max(15, (width - $('properties').getBoundingClientRect().width - 107) / width * 100)) : 65;
  splitPercent = Math.max(15, Math.min(maximum, percent));
  $('source-pane').style.width = splitPercent + '%';
  $('splitter').setAttribute('aria-valuenow', String(Math.round(splitPercent)));
}
const splitter = $('splitter');
window.addEventListener('resize', () => setSplit(splitPercent));
function dragSplit(event) {
  const bounds = $('workspace').getBoundingClientRect();
  const available = bounds.width - $('properties').getBoundingClientRect().width;
  if (available > 0) setSplit((event.clientX - bounds.left) / bounds.width * 100);
}
splitter.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  event.preventDefault(); splitter.setPointerCapture(event.pointerId); dragSplit(event);
});
splitter.addEventListener('pointermove', (event) => { if (splitter.hasPointerCapture(event.pointerId)) dragSplit(event); });
for (const type of ['pointerup','pointercancel']) splitter.addEventListener(type, (event) => {
  if (splitter.hasPointerCapture(event.pointerId)) splitter.releasePointerCapture(event.pointerId);
});
splitter.addEventListener('keydown', (event) => {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  event.preventDefault(); setSplit(event.key === 'Home' ? 15 : event.key === 'End' ? 65 : splitPercent + (event.key === 'ArrowLeft' ? -2 : 2));
});

$('toggle-source').addEventListener('click', () => showSource($('source-pane').hidden));
$('select-tool').addEventListener('click', () => view?.setTool('select'));
$('connect-tool').addEventListener('click', () => view?.setTool('connect'));
$('add').addEventListener('click', () => { view?.commitActiveEdit(); view?.addNode($('add-shape').value, '新しいノード'); });
$('direction').addEventListener('change', () => dispatch({ type:'setDirection', direction:$('direction').value }));
$('undo').addEventListener('click', () => { view?.commitActiveEdit(); editor?.undo(); });
$('redo').addEventListener('click', () => { view?.commitActiveEdit(); editor?.redo(); });
$('connect').addEventListener('click', () => dispatch({ type:'connect', source:$('from').value, target:$('to').value }));
$('label').addEventListener('change', () => {
  const entity = selected(); if (!entity) return;
  const label = $('label').value.replace(/\r?\n/g, '<br/>');
  if (entity.entityId.startsWith('node:')) dispatch({ type:'renameNode', id:entity.id, label });
  else if (entity.entityId.startsWith('edge:')) dispatch({ type:'setEdgeLabel', edgeId:entity.entityId, label });
  else dispatch({ type:'renameSubgraph', id:entity.id, title:label });
});
$('shape').addEventListener('change', () => { const node = selected(); if (node?.entityId.startsWith('node:')) dispatch({ type:'setNodeShape', id:node.id, shape:$('shape').value }); });
for (const [id,prop] of [['fill','fill'],['stroke','stroke'],['text-color','color']]) $(id).addEventListener('change', () => {
  const node = selected(); if (node?.entityId.startsWith('node:')) dispatch({ type:'setNodeColor', id:node.id, prop, value:$(id).value });
});
$('reset-colors').addEventListener('click', () => {
  const node = selected(); if (!node?.entityId.startsWith('node:')) return;
  for (const prop of ['fill','stroke','color']) dispatch({ type:'setNodeColor', id:node.id, prop, value:null });
});
$('duplicate').addEventListener('click', () => { const node = selected(); if (node?.entityId.startsWith('node:')) dispatch({ type:'duplicateNode', id:node.id }); });
for (const id of ['line','arrow']) $(id).addEventListener('change', () => {
  const edge = selected(); if (edge?.entityId.startsWith('edge:')) dispatch({ type:'setEdgeStyle', edgeId:edge.entityId, line:$('line').value, arrowEnd:$('arrow').value });
});
$('reverse').addEventListener('click', () => { const edge = selected(); if (edge?.entityId.startsWith('edge:')) dispatch({ type:'reverseEdge', edgeId:edge.entityId }); });
$('delete').addEventListener('click', () => { view?.commitActiveEdit(); if (editor?.result.flowchart) editor.deleteEntities([...editor.selection]); });
source.addEventListener('input', () => { if (editor) editor.setCode(source.value, 'code'); });
function selectFromSource() {
  if (!editor) return;
  const entity = editor.entityAt(source.selectionStart);
  editor.setSelection(entity ? [entity] : [], 'code');
}
source.addEventListener('click', selectFromSource);
source.addEventListener('keyup', selectFromSource);
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || !editor) return;
  if (event.key.toLowerCase() === 'z' || event.key.toLowerCase() === 'y') {
    event.preventDefault(); event.stopImmediatePropagation(); view.commitActiveEdit();
    if (event.shiftKey || event.key.toLowerCase() === 'y') editor.redo(); else editor.undo();
  }
}, true);

function getSource() {
  view?.commitActiveEdit();
  const code = editor?.code || '';
  if (!code.trim() || code.length > MAX_TEXT) throw new Error('Mermaid記法が空か、サイズ上限を超えています');
  if (renderedSource !== code || view.renderError) throw new Error('最新の図の描画が完了するまで待ってください');
  return code;
}
async function prepareCopy(code) {
  if (code !== editor.code) throw new Error('図が変更されました。再度コピーしてください');
  const result = await window.markinkMermaid.render('markink-wysiwyg-copy-' + (++copySerial), code);
  if (code !== editor.code) throw new Error('図が変更されました。再度コピーしてください');
  copySurface.innerHTML = result.svg;
  const svg = copySurface.querySelector('svg');
  const box = svg.viewBox.baseVal;
  if (box.width <= 0 || box.height <= 0) throw new Error('図のサイズを取得できません');
  svg.style.maxWidth = 'none'; svg.style.width = box.width + 'px'; svg.style.height = box.height + 'px';
  copySurface.style.width = box.width + 'px';
  return copySurface;
}
save.addEventListener('click', async () => {
  if (!editor || applying) return;
  view.commitActiveEdit();
  const code = editor.code;
  if (!code.trim() || code.length > MAX_TEXT) { showError('Mermaid記法が空か、サイズ上限を超えています'); return; }
  applying = true; updateHistory(); status.textContent = '文書に反映中…';
  try {
    await window.markinkMermaid.parse(code);
    pendingApply = code;
    parent.postMessage({ type:'markink-editor-apply', value:code }, '*');
  } catch (cause) { applying = false; updateHistory(); showError(cause); status.textContent = '記法を確認してください'; }
});
window.addEventListener('message', (event) => {
  if (event.source !== parent) return;
  if (event.data?.type === 'markink-editor-apply-result') {
    applying = false; updateHistory();
    if (event.data.error) { showError(event.data.error); status.textContent = '反映できませんでした'; }
    else { error.style.display = 'none'; status.textContent = editor.code === pendingApply ? '文書に反映しました' : '文書に反映しました（未反映の変更あり）'; }
  } else if (event.data?.type === 'markink-render-copy-result') {
    status.textContent = event.data.error ? 'コピーできませんでした' : 'コピーしました';
  }
});

const url = URL.createObjectURL(new Blob([library], { type:'text/javascript' }));
const script = document.createElement('script'); script.src = url;
script.onload = () => {
  URL.revokeObjectURL(url);
  try {
    const { MermaidWysiwygEditor, MermaidCanvasView } = window.markinkMermaidWysiwyg;
    editor = new MermaidWysiwygEditor({ code:initial });
    const mermaid = window.markinkMermaid;
    const facade = {
      initialize: (config) => mermaid.initialize(config), parse: (...args) => mermaid.parse(...args),
      render: async (id, code) => {
        const result = await mermaid.render(id, code);
        if (editor.code === code) renderedSource = code;
        return result;
      }
    };
    view = new MermaidCanvasView({ editor, container:diagram, mermaid:facade,
      selectionBoundary:document.body, panZoom:true, accentColor:'#2563eb', debounceMs:250,
      readOnly:!editor.result.flowchart,
      mermaidConfig:{ startOnLoad:false, securityLevel:'strict', htmlLabels:false, state:{defaultRenderer:'dagre-wrapper'}, theme:'default', suppressErrorRendering:true, maxTextSize:MAX_TEXT } });
    editor.on('change', ({ code }) => {
      if (source.value !== code) source.value = code;
      menu.style.display = 'none';
      status.textContent = '図を更新中…';
      updateHistory(); updateMode(); refreshConnections(); refreshProperties();
      if (code.length > MAX_TEXT) showError('サイズ上限を超えています。元に戻してから反映してください');
    });
    editor.on('selectionChange', () => refreshProperties());
    view.on('toolChange', (tool) => {
      $('select-tool').setAttribute('aria-pressed', String(tool === 'select'));
      $('connect-tool').setAttribute('aria-pressed', String(tool === 'connect'));
    });
    view.on('render', ({ ok, error:renderError }) => {
      if (ok && renderedSource === editor.code) {
        status.textContent = editor.result.flowchart ? '図をクリックして編集できます。接続はノード間をドラッグしてください' : 'この図は記法欄から編集できます';
        error.style.display = 'none'; refreshProperties();
      } else if (!ok) { status.textContent = '記法を確認してください'; showError(renderError); }
    });
    updateHistory(); updateMode(); refreshConnections();
    status.textContent = '図を描画中…';
    window.addEventListener('beforeunload', () => view.destroy(), { once:true });
  } catch (cause) { showError(cause); status.textContent = 'エディタを初期化できません'; }
};
script.onerror = () => { URL.revokeObjectURL(url); showError('編集ライブラリを読み込めません'); };
document.head.append(script);
