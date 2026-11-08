const MARKER = 'markink-shape-editor';
const MAX_SHAPES = 100;

function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[char]);
}

function svgFor(state) {
  const width = Math.max(100, Math.min(1600, Number(state.width) || 800));
  const height = Math.max(100, Math.min(1200, Number(state.height) || 500));
  const shapes = state.shapes.slice(0, MAX_SHAPES);
  const metadata = base64(new TextEncoder().encode(JSON.stringify({ width, height, shapes })));
  const body = shapes.map((shape) => {
    const x = Math.max(-1600, Math.min(1600, Number(shape.x) || 0));
    const y = Math.max(-1200, Math.min(1200, Number(shape.y) || 0));
    const w = Math.max(1, Math.min(1600, Number(shape.w) || 1));
    const h = Math.max(1, Math.min(1200, Number(shape.h) || 1));
    const fill = /^#[0-9a-fA-F]{6}$/.test(shape.fill) ? shape.fill : '#ffffff';
    const stroke = /^#[0-9a-fA-F]{6}$/.test(shape.stroke) ? shape.stroke : '#334155';
    const sw = Math.max(0, Math.min(20, Number(shape.strokeWidth) || 0));
    const style = `fill="${fill}" stroke="${stroke}" stroke-width="${sw}"`;
    if (shape.type === 'rect') return `<rect x="${x}" y="${y}" width="${w}" height="${h}" ${style}/>`;
    if (shape.type === 'ellipse') return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${style}/>`;
    if (shape.type === 'line') return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" stroke="${stroke}" stroke-width="${Math.max(1, sw)}"/>`;
    if (shape.type === 'text') return `<text x="${x}" y="${y + h}" font-family="sans-serif" font-size="${Math.max(8, Math.min(96, h))}" fill="${fill}">${escapeXml(String(shape.text || '').slice(0, 200))}</text>`;
    return '';
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><metadata id="${MARKER}">${metadata}</metadata><rect width="100%" height="100%" fill="#ffffff"/>${body}</svg>`;
}

function stateFromImage(src) {
  if (!src.startsWith('data:image/svg+xml;base64,')) throw new Error('図形エディタで作成した画像を選択してください');
  const xml = new TextDecoder().decode(Uint8Array.from(atob(src.slice(26)), (c) => c.charCodeAt(0)));
  const match = xml.match(/<metadata id="markink-shape-editor">([A-Za-z0-9+/=]+)<\/metadata>/);
  if (!match) throw new Error('図形エディタで作成した画像を選択してください');
  const state = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0))));
  if (!Array.isArray(state.shapes) || state.shapes.length > MAX_SHAPES) throw new Error('図形データが不正です');
  return state;
}

function editorHtml(state) {
  const initial = JSON.stringify(state).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font:13px 'Segoe UI',sans-serif;color:#1e293b;background:#f1f5f9}
    #bar{display:flex;gap:5px;align-items:center;padding:8px;background:white;border-bottom:1px solid #cbd5e1;flex-wrap:wrap}
    button{border:1px solid #94a3b8;background:white;border-radius:4px;padding:5px 9px;cursor:pointer}
    button:hover{background:#e2e8f0}button.primary{background:#2563eb;color:white;border-color:#2563eb}
    #layout{display:flex;height:calc(100vh - 54px)}#surface{flex:1;overflow:auto;padding:16px}
    svg{background:white;box-shadow:0 2px 10px #0002;max-width:none;touch-action:none}
    .selected{stroke:#2563eb;stroke-dasharray:5 3}#props{width:210px;background:white;border-left:1px solid #cbd5e1;padding:12px;overflow:auto}
    label{display:block;margin:8px 0}input{display:block;width:100%;padding:4px;margin-top:3px}input[type=color]{height:34px;padding:2px}
    #hint{color:#64748b;margin-bottom:10px}
  </style><div id="bar"><button data-add="rect">四角形</button><button data-add="ellipse">楕円</button><button data-add="line">線</button><button data-add="text">文字</button><button id="delete">削除</button><span style="flex:1"></span><button id="save" class="primary">文書に反映</button></div>
  <div id="layout"><div id="surface"><svg id="canvas" xmlns="http://www.w3.org/2000/svg"></svg></div><aside id="props"><div id="hint">図形を選択し、ドラッグで移動できます。</div><div id="fields"></div></aside></div>
  <script>let state=${initial};let selected=-1;let drag=null;const svg=document.getElementById('canvas');const fields=document.getElementById('fields');
    const ns='http://www.w3.org/2000/svg';
    function element(tag,attrs){const e=document.createElementNS(ns,tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e}
    function render(){svg.setAttribute('width',state.width);svg.setAttribute('height',state.height);svg.setAttribute('viewBox','0 0 '+state.width+' '+state.height);svg.replaceChildren();
      state.shapes.forEach((s,i)=>{let e;const common={stroke:s.stroke,'stroke-width':s.strokeWidth,fill:s.fill};
        if(s.type==='rect')e=element('rect',{x:s.x,y:s.y,width:s.w,height:s.h,...common});
        else if(s.type==='ellipse')e=element('ellipse',{cx:s.x+s.w/2,cy:s.y+s.h/2,rx:s.w/2,ry:s.h/2,...common});
        else if(s.type==='line')e=element('line',{x1:s.x,y1:s.y,x2:s.x+s.w,y2:s.y+s.h,stroke:s.stroke,'stroke-width':Math.max(2,s.strokeWidth)});
        else{e=element('text',{x:s.x,y:s.y+s.h,'font-family':'sans-serif','font-size':s.h,fill:s.fill});e.textContent=s.text||''}
        if(i===selected)e.classList.add('selected');e.style.cursor='move';e.addEventListener('pointerdown',ev=>{ev.stopPropagation();selected=i;drag={x:ev.clientX,y:ev.clientY,ox:s.x,oy:s.y};svg.setPointerCapture(ev.pointerId);render();properties()});svg.appendChild(e)});
    }
    function field(label,key,type='number'){const s=state.shapes[selected];const row=document.createElement('label');row.textContent=label;const input=document.createElement('input');input.type=type;input.value=s[key];input.addEventListener('input',()=>{s[key]=type==='number'?Number(input.value):input.value;render()});row.append(input);fields.append(row)}
    function properties(){fields.replaceChildren();if(selected<0)return;field('X','x');field('Y','y');if(state.shapes[selected].type!=='text'){field('幅','w');field('高さ','h')}else field('文字','text','text');field('塗り','fill','color');field('線','stroke','color');field('線幅','strokeWidth')}
    document.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>{if(state.shapes.length>=100)return;const type=b.dataset.add;state.shapes.push({type,x:60+state.shapes.length*12,y:60+state.shapes.length*12,w:140,h:type==='text'?30:90,fill:type==='line'?'#ffffff':'#dbeafe',stroke:'#334155',strokeWidth:2,text:'テキスト'});selected=state.shapes.length-1;render();properties()});
    document.getElementById('delete').onclick=()=>{if(selected<0)return;state.shapes.splice(selected,1);selected=-1;render();properties()};
    document.getElementById('save').onclick=()=>parent.postMessage({type:'markink-editor-result',value:JSON.stringify(state)},'*');
    svg.addEventListener('pointerdown',()=>{selected=-1;render();properties()});
    svg.addEventListener('pointermove',ev=>{if(!drag||selected<0)return;const s=state.shapes[selected];const box=svg.getBoundingClientRect();s.x=Math.round(drag.ox+(ev.clientX-drag.x)*state.width/box.width);s.y=Math.round(drag.oy+(ev.clientY-drag.y)*state.height/box.height);render()});
    svg.addEventListener('pointerup',()=>drag=null);svg.addEventListener('pointercancel',()=>drag=null);render();
  </script></html>`;
}

async function edit(api, existing) {
  const snapshot = await api.readDocument();
  if (!snapshot.selection) throw new Error('文書を開いてください');
  const image = snapshot.selectedImage;
  const state = existing ? stateFromImage(image?.src || '') : { width: 800, height: 500, shapes: [] };
  const result = await api.openEditor(existing ? '図形を編集' : '図形を作成', editorHtml(state));
  if (result === null) return;
  const updated = JSON.parse(result);
  if (!Array.isArray(updated.shapes) || updated.shapes.length > MAX_SHAPES) throw new Error('図形データが不正です');
  const svg = svgFor(updated);
  const src = 'data:image/svg+xml;base64,' + base64(new TextEncoder().encode(svg));
  const current = await api.readDocument();
  const target = existing ? image : snapshot.selection;
  if (!target || current.revision !== snapshot.revision) throw new Error('編集中に文書が更新されました。再度開いてください');
  await api.applyEdit({ baseRevision: snapshot.revision, from: target.from, to: target.to, markdown: '![図形](' + src + ')' });
}

self.markinkPlugin = {
  async activate(api) {
    await api.registerCommand({ id: 'create-shape', title: '図形を作成', placement: 'menu' }, () => edit(api, false));
    await api.registerCommand({ id: 'edit-shape', title: '選択した図形を編集', placement: 'menu', contextMenu: true }, () => edit(api, true));
  }
};
