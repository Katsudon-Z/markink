const DEFAULT_SOURCE = 'flowchart TD\n    A[開始] --> B{確認}\n    B -->|はい| C[完了]\n    B -->|いいえ| A';
const MAX_SOURCE = 100_000;
let browserBundle = null;

function decodeBase64(value) {
  return new TextDecoder().decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0)));
}

function sourceFromImage(src) {
  const prefix = 'data:image/svg+xml;base64,';
  if (!src.startsWith(prefix)) throw new Error('Mermaidエディタで作成した画像を選択してください');
  const svg = decodeBase64(src.slice(prefix.length));
  const match = svg.match(/<metadata id="markink-mermaid-editor">([A-Za-z0-9+/=]+)<\/metadata>/);
  if (!match) throw new Error('Mermaidエディタで作成した画像を選択してください');
  const source = decodeBase64(match[1]);
  if (!source || source.length > MAX_SOURCE) throw new Error('保存されたMermaid記法が不正です');
  return source;
}

function editorHtml(source, bundle) {
  const initial = JSON.stringify(source).replace(/</g, '\\u003c');
  const library = JSON.stringify(bundle).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;font:13px 'Segoe UI',Meiryo,sans-serif;color:#1e293b;background:#f1f5f9}
    #top{display:flex;align-items:center;gap:10px;padding:8px 12px;background:white;border-bottom:1px solid #cbd5e1}
    #status{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569}
    #save{padding:7px 12px;border:0;border-radius:5px;background:#2563eb;color:white;cursor:pointer}
    #save:disabled{background:#94a3b8;cursor:not-allowed}
    #main{height:calc(100vh - 49px);display:grid;grid-template-columns:42% 58%}
    #source{width:100%;height:100%;resize:none;border:0;border-right:1px solid #cbd5e1;padding:14px;font:13px/1.5 Consolas,monospace;outline:0}
    #preview{overflow:auto;padding:20px;background:white}
    #preview svg{max-width:100%;height:auto}
    #error{display:none;padding:10px;color:#b91c1c;white-space:pre-wrap;overflow-wrap:anywhere}
  </style><div id="top"><strong>Mermaid</strong><span id="status">描画ライブラリを読み込み中…</span><button id="save" disabled>文書に反映</button></div>
  <div id="main"><textarea id="source" spellcheck="false" aria-label="Mermaid記法"></textarea><div id="preview"><div id="error"></div><div id="diagram"></div></div></div>
  <script>
    const source = document.getElementById('source');
    const status = document.getElementById('status');
    const save = document.getElementById('save');
    const error = document.getElementById('error');
    const diagram = document.getElementById('diagram');
    source.value = ${initial};
    let lastSvg = '';
    let lastSource = '';
    let renderTimer;
    let rendering = false;
    let requested = false;
    let serial = 0;
    function schedule(){save.disabled=true;requested=true;clearTimeout(renderTimer);renderTimer=setTimeout(renderDiagram,350)}
    async function renderDiagram(){
      if(!window.markinkMermaid || rendering)return;
      const text=source.value.trim();
      if(!text){status.textContent='Mermaid記法を入力してください';diagram.replaceChildren();save.disabled=true;return}
      rendering=true;requested=false;const current=++serial;
      status.textContent='描画中…';error.style.display='none';
      try{
        const result=await window.markinkMermaid.render('markink-mermaid-preview-'+current,text);
        if(source.value.trim()!==text)return;
        lastSvg=result.svg;lastSource=text;diagram.innerHTML=result.svg;
        status.textContent='プレビュー更新済み';save.disabled=false;
      }catch(cause){
        if(source.value.trim()!==text)return;
        lastSvg='';save.disabled=true;diagram.replaceChildren();
        error.textContent=String(cause && cause.message || cause).slice(0,2000);
        error.style.display='block';status.textContent='記法を確認してください';
      }finally{rendering=false;if(requested)schedule()}
    }
    source.addEventListener('input',schedule);
    save.addEventListener('click',()=>{
      if(!lastSvg || lastSource!==source.value.trim())return;
      parent.postMessage({type:'markink-editor-result',value:lastSource},'*');
    });
    const library=${library};
    const url=URL.createObjectURL(new Blob([library],{type:'text/javascript'}));
    const script=document.createElement('script');script.src=url;
    script.onload=()=>{
      URL.revokeObjectURL(url);
      if(!window.markinkMermaid){status.textContent='Mermaidを初期化できません';return}
      window.markinkMermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:'default',suppressErrorRendering:true,maxTextSize:${MAX_SOURCE}});
      schedule();
    };
    script.onerror=()=>{URL.revokeObjectURL(url);status.textContent='Mermaidを読み込めません'};
    document.head.append(script);
  </script></html>`;
}

function renderHtml(bundle) {
  const library = JSON.stringify(bundle).replace(/</g, '\\u003c');
  return `<meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#fff;color:#334155;font:13px Meiryo,sans-serif;overflow:hidden}
    #diagram svg{display:block;max-width:100%;height:auto;margin:auto}
    #error{color:#b91c1c;white-space:pre-wrap;overflow-wrap:anywhere}
  </style><div id="diagram"></div><div id="error"></div><script>
    const diagram=document.getElementById('diagram');
    const error=document.getElementById('error');
    const reportHeight=()=>parent.postMessage({type:'markink-render-height',height:document.body.scrollHeight+24},'*');
    const library=${library};
    const url=URL.createObjectURL(new Blob([library],{type:'text/javascript'}));
    const script=document.createElement('script');script.src=url;
    script.onload=async()=>{
      URL.revokeObjectURL(url);
      try{
        window.markinkMermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,theme:'default',suppressErrorRendering:true,maxTextSize:${MAX_SOURCE}});
        const result=await window.markinkMermaid.render('markink-mermaid-document',window.markinkCodeBlockSource);
        diagram.innerHTML=result.svg;
      }catch(cause){error.textContent=String(cause && cause.message || cause).slice(0,2000)}
      reportHeight();
    };
    script.onerror=()=>{URL.revokeObjectURL(url);error.textContent='Mermaidを読み込めません';reportHeight()};
    document.head.append(script);
  </script>`;
}

async function edit(api, existing) {
  const snapshot = await api.readDocument();
  if (!snapshot.selection) throw new Error('編集できる文書を開いてください');
  const block = snapshot.selectedCodeBlock;
  const isMermaid = block && block.params.trim().toLowerCase() === 'mermaid';
  const legacyImage = snapshot.selectedImage;
  if (existing && !isMermaid && !legacyImage) throw new Error('Mermaid記法のコードブロックにカーソルを置いてください');
  const source = existing
    ? isMermaid ? block.text : sourceFromImage(legacyImage.src)
    : DEFAULT_SOURCE;
  if (!browserBundle) browserBundle = await api.readPackageText('mermaid.bundle.js');
  const result = await api.openEditor(existing ? 'Mermaid図を編集' : 'Mermaid図を作成', editorHtml(source, browserBundle));
  if (result === null) return;
  if (!result.trim() || result.length > MAX_SOURCE) {
    throw new Error('Mermaid記法が不正か、サイズ上限を超えています');
  }
  let longest = 2;
  for (const run of result.match(/`{3,}/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const markdown = `${fence}mermaid\n${result.trimEnd()}\n${fence}`;
  const current = await api.readDocument();
  const target = existing ? isMermaid ? block : legacyImage : snapshot.selection;
  if (!target || current.revision !== snapshot.revision) {
    throw new Error('編集中に文書が更新されました。再度開いてください');
  }
  await api.applyEdit({ baseRevision: snapshot.revision, from: target.from, to: target.to, markdown });
}

self.markinkPlugin = {
  async activate(api) {
    if (!browserBundle) browserBundle = await api.readPackageText('mermaid.bundle.js');
    await api.registerCodeBlockRenderer('mermaid', renderHtml(browserBundle));
    await api.registerCommand({ id: 'create-mermaid', title: 'Mermaid図を作成', placement: 'menu' }, () => edit(api, false));
    await api.registerCommand({ id: 'edit-mermaid', title: 'Mermaid記法を編集', placement: 'menu', contextMenu: true }, () => edit(api, true));
  }
};
