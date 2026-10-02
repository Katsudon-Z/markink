const DEFAULT_SOURCE = 'flowchart TD\n    A[開始] --> B{確認}\n    B -->|はい| C[完了]\n    B -->|いいえ| A';
const MAX_SOURCE = 100_000;
let browserBundle = null;
let officeDrawingSource = null;

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

function copyStyle(){return `    #copy-menu{display:none;position:fixed;z-index:10;min-width:180px;padding:4px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 4px 16px #0003}
    #copy-menu button{display:block;width:100%;border:0;background:none;text-align:left;padding:8px;cursor:pointer;font:13px Meiryo,sans-serif}
    #copy-menu button:hover{background:#e8f0ff}
`;}

function copyScript(){return `    let copying=false;
    document.addEventListener('keydown',(event)=>{if(event.key==='Escape')menu.style.display='none'});
    window.addEventListener('resize',()=>{menu.style.display='none'});
    document.addEventListener('scroll',()=>{menu.style.display='none'},true);
    async function pngData(){
      const svg=diagram.querySelector('svg');
      if(!svg)throw new Error('描画が完了していません');
      const box=svg.getBoundingClientRect(),width=Math.max(1,Math.ceil(box.width*2)),height=Math.max(1,Math.ceil(box.height*2));
      if(width*height>20000000)throw new Error('PNG画像が大きすぎます');
      const serialized=new XMLSerializer().serializeToString(svg);
      const image=new Image();
      const url=URL.createObjectURL(new Blob([serialized],{type:'image/svg+xml'}));
      try{
        await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('PNG変換に失敗しました'));image.src=url});
        const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
        const context=canvas.getContext('2d');
        if(!context)throw new Error('PNG変換に失敗しました');
        context.fillStyle='#fff';context.fillRect(0,0,width,height);
        context.drawImage(image,0,0,width,height);
        return canvas.toDataURL('image/png');
      }finally{URL.revokeObjectURL(url)}
    }
    function showCopyMenu(x,y){
      menu.style.display='block';
      menu.style.left=Math.max(0,Math.min(x,innerWidth-190))+'px';
      menu.style.top=Math.max(0,Math.min(y,innerHeight-menu.offsetHeight-8))+'px';
    }
    document.addEventListener('contextmenu',(event)=>{
      if(!diagram.contains(event.target))return;
      event.preventDefault();
      if(selectDocument)parent.postMessage({type:'markink-render-select',focus:false},'*');
      showCopyMenu(event.clientX,event.clientY);
    },true);
    if(selectDocument)diagram.addEventListener('click',()=>parent.postMessage({type:'markink-render-select'},'*'));
    document.addEventListener('click',(event)=>{if(!menu.contains(event.target))menu.style.display='none'});
    menu.addEventListener('click',async(event)=>{
      const commandId=event.target?.dataset?.command;
      if(commandId){menu.style.display='none';parent.postMessage({type:'markink-render-command',commandId},'*');return;}
      const format=event.target?.dataset?.format;
      if(!format || copying)return;
      menu.style.display='none';error.textContent='';error.style.display='none';copying=true;
      try{
        const currentSource=getSource();
        const value=format==='text'?currentSource:format==='png'?await pngData():await window.markinkOfficeDrawing(currentSource,diagram);
        const targetFormat=format==='powerpoint'?'office-drawing':format;
        if(new TextEncoder().encode(value).byteLength>16*1024*1024)throw new Error('コピーする図が大きすぎます');
        parent.postMessage({type:'markink-render-copy',format:targetFormat,value},'*');
      }catch(cause){copying=false;error.textContent=String(cause&&cause.message||cause);error.style.display='block';reportHeight()}
    });
    window.addEventListener('message',(event)=>{
      if(event.source!==parent || event.data?.type!=='markink-render-copy-result')return;
      copying=false;error.textContent=event.data.error||'';error.style.display=event.data.error?'block':'none';reportHeight();
    });
`;}

function editorHtml(source, bundle) {
  const initial = JSON.stringify(source).replace(/</g, '\\u003c');
  const library = JSON.stringify(`${bundle}\n${officeDrawingSource}`).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{height:100vh;display:flex;flex-direction:column;overflow:hidden;margin:0;font:13px 'Segoe UI',Meiryo,sans-serif;color:#1e293b;background:#f1f5f9}
    #top{display:flex;align-items:center;gap:10px;padding:8px 12px;background:white;border-bottom:1px solid #cbd5e1}
    #status{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#475569}
    #save{padding:7px 12px;border:0;border-radius:5px;background:#2563eb;color:white;cursor:pointer}
    #save:disabled{background:#94a3b8;cursor:not-allowed}
    #main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,var(--source-width,42%)) 7px minmax(0,1fr)}
    #splitter{background:#cbd5e1;cursor:col-resize;touch-action:none}
    #splitter:hover,#splitter:focus-visible{background:#2563eb;outline:none}
    #source{min-width:0;width:100%;height:100%;resize:none;border:0;border-right:1px solid #cbd5e1;padding:14px;font:13px/1.5 Consolas,monospace;outline:0}
    #preview{min-width:0;min-height:0;overflow:auto;padding:20px;background:white}
    #preview svg{max-width:100%;height:auto}
    #error{display:none;padding:10px;color:#b91c1c;white-space:pre-wrap;overflow-wrap:anywhere}
    ${copyStyle()}
  </style><div id="top"><strong>Mermaid</strong><span id="status">描画ライブラリを読み込み中…</span><button id="save" disabled>文書に反映</button></div>
  <div id="main"><textarea id="source" spellcheck="false" aria-label="Mermaid記法"></textarea><div id="splitter" role="separator" tabindex="0" aria-label="入力欄とプレビューの幅" aria-orientation="vertical" aria-valuemin="15" aria-valuemax="85" aria-valuenow="42"></div><div id="preview"><div id="error"></div><div id="diagram"></div></div></div>
  <div id="copy-menu"><button data-format="text">Mermaid記法</button><button data-format="powerpoint">PowerPoint図</button><button data-format="png">PNG</button></div>
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
    let applying = false;
    let serial = 0;
    const main=document.getElementById('main');
    const splitter=document.getElementById('splitter');
    const menu=document.getElementById('copy-menu');
    let splitPercent=42;
    const setSplit=(percent)=>{
      splitPercent=Math.max(15,Math.min(85,percent));
      main.style.setProperty('--source-width',splitPercent+'%');
      splitter.setAttribute('aria-valuenow',String(Math.round(splitPercent)));
    };
    const drag=(event)=>{
      const box=main.getBoundingClientRect();
      if(box.width)setSplit((event.clientX-box.left)/box.width*100);
    };
    splitter.addEventListener('pointerdown',(event)=>{
      if(event.button!==0)return;
      event.preventDefault();splitter.setPointerCapture(event.pointerId);drag(event);
    });
    splitter.addEventListener('pointermove',(event)=>{if(splitter.hasPointerCapture(event.pointerId))drag(event)});
    const endDrag=(event)=>{if(splitter.hasPointerCapture(event.pointerId))splitter.releasePointerCapture(event.pointerId)};
    splitter.addEventListener('pointerup',endDrag);splitter.addEventListener('pointercancel',endDrag);
    splitter.addEventListener('keydown',(event)=>{
      if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
      event.preventDefault();
      setSplit(event.key==='Home'?15:event.key==='End'?85:splitPercent+(event.key==='ArrowLeft'?-2:2));
    });
    const getSource=()=>{
      if(!lastSvg || lastSource!==source.value.trim())throw new Error('最新のプレビューの描画を待ってください');
      return lastSource;
    };
    const selectDocument=false;
    const reportHeight=()=>{};
    ${copyScript()}
    function schedule(){menu.style.display='none';save.disabled=true;requested=true;clearTimeout(renderTimer);renderTimer=setTimeout(renderDiagram,350)}
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
        status.textContent='プレビュー更新済み';save.disabled=applying;
      }catch(cause){
        if(source.value.trim()!==text)return;
        lastSvg='';save.disabled=true;diagram.replaceChildren();
        error.textContent=String(cause && cause.message || cause).slice(0,2000);
        error.style.display='block';status.textContent='記法を確認してください';
      }finally{rendering=false;if(requested)schedule()}
    }
    source.addEventListener('input',schedule);
    save.addEventListener('click',()=>{
      if(applying || !lastSvg || lastSource!==source.value.trim())return;
      applying=true;save.disabled=true;status.textContent='文書に反映中…';
      parent.postMessage({type:'markink-editor-apply',value:lastSource},'*');
    });
    window.addEventListener('message',(event)=>{
      if(event.source!==parent || event.data?.type!=='markink-editor-apply-result')return;
      applying=false;
      status.textContent=event.data.error?'反映できませんでした':'文書に反映しました';
      error.textContent=event.data.error||'';error.style.display=event.data.error?'block':'none';
      save.disabled=rendering || !lastSvg || lastSource!==source.value.trim();
    });
    const library=${library};
    const url=URL.createObjectURL(new Blob([library],{type:'text/javascript'}));
    const script=document.createElement('script');script.src=url;
    script.onload=()=>{
      URL.revokeObjectURL(url);
      if(!window.markinkMermaid){status.textContent='Mermaidを初期化できません';return}
      window.markinkMermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,state:{defaultRenderer:'dagre-wrapper'},theme:'default',suppressErrorRendering:true,maxTextSize:${MAX_SOURCE}});
      schedule();
    };
    script.onerror=()=>{URL.revokeObjectURL(url);status.textContent='Mermaidを読み込めません'};
    document.head.append(script);
  </script></html>`;
}

function renderHtml(bundle, officeDrawingSource) {
  const library = JSON.stringify(`${bundle}\n${officeDrawingSource}`).replace(/</g, '\\u003c');
  return `<meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#fff;color:#334155;font:13px Meiryo,sans-serif;overflow:auto}
    #diagram svg{display:block;max-width:100%;height:auto;margin:auto}
    #error{color:#b91c1c;white-space:pre-wrap;overflow-wrap:anywhere}
    ${copyStyle()}
  </style><div id="diagram"></div><div id="error"></div><div id="copy-menu"><button data-command="edit-mermaid">図を編集</button><button data-format="text">Mermaid記法</button><button data-format="powerpoint">PowerPoint図</button><button data-format="png">PNG</button></div><script>
    const diagram=document.getElementById('diagram');
    const error=document.getElementById('error');
    const menu=document.getElementById('copy-menu');
    let reportedHeight=0;
    let heightFrame=0;
    const reportHeight=()=>{
      cancelAnimationFrame(heightFrame);
      heightFrame=requestAnimationFrame(()=>{
        const height=Math.ceil(diagram.getBoundingClientRect().height+error.getBoundingClientRect().height+24);
        if(height===reportedHeight)return;
        reportedHeight=height;
        parent.postMessage({type:'markink-render-height',height},'*');
      });
    };
    const sizeObserver=new ResizeObserver(reportHeight);
    sizeObserver.observe(diagram);sizeObserver.observe(error);
    window.addEventListener('resize',reportHeight);
    const getSource=()=>window.markinkCodeBlockSource;
    const selectDocument=true;
    ${copyScript()}
    const library=${library};
    const url=URL.createObjectURL(new Blob([library],{type:'text/javascript'}));
    const script=document.createElement('script');script.src=url;
    script.onload=async()=>{
      URL.revokeObjectURL(url);
      try{
        window.markinkMermaid.initialize({startOnLoad:false,securityLevel:'strict',htmlLabels:false,state:{defaultRenderer:'dagre-wrapper'},theme:'default',suppressErrorRendering:true,maxTextSize:${MAX_SOURCE}});
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
  let target = existing ? isMermaid ? block : legacyImage : snapshot.selection;
  let revision = snapshot.revision;
  const apply = async (result) => {
  if (!result.trim() || result.length > MAX_SOURCE) {
    throw new Error('Mermaid記法が不正か、サイズ上限を超えています');
  }
  let longest = 2;
  for (const run of result.match(/`{3,}/g) ?? []) longest = Math.max(longest, run.length);
  const fence = '`'.repeat(longest + 1);
  const markdown = `${fence}mermaid\n${result.trimEnd()}\n${fence}`;
  const current = await api.readDocument();
  if (!target || current.revision !== revision) {
    throw new Error('編集中に文書が更新されました。再度開いてください');
  }
  const applied = await api.applyEdit({ baseRevision: revision, from: target.from, to: target.to, markdown });
  target = { from: applied.from, to: applied.to };
  revision = applied.revision;
  };
  await api.openEditor(existing ? 'Mermaid図を編集' : 'Mermaid図を作成', editorHtml(source, browserBundle), apply);
}

self.markinkPlugin = {
  async activate(api) {
    if (!browserBundle) browserBundle = await api.readPackageText('mermaid.bundle.js');
    officeDrawingSource = (await api.readPackageText('office-drawing.js')) + '\n' + (await api.readPackageText('sequence-office-drawing.js')) + '\n' + (await api.readPackageText('state-office-drawing.js')) + '\n' + (await api.readPackageText('pie-office-drawing.js')) + '\n' + (await api.readPackageText('architecture-office-drawing.js'));
    await api.registerCodeBlockRenderer('mermaid', renderHtml(browserBundle, officeDrawingSource));
    await api.registerCommand({ id: 'create-mermaid', title: 'Mermaid図を作成', placement: 'menu' }, () => edit(api, false));
    await api.registerCommand({ id: 'edit-mermaid', title: 'Mermaid記法を編集', placement: 'menu', contextMenu: true }, () => edit(api, true));
  }
};
