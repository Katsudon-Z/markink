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
      if(selectDocument&&window.markinkHostCopyMenu){parent.postMessage({type:'markink-render-context-menu',x:event.clientX,y:event.clientY},'*');return;}
      if(selectDocument)parent.postMessage({type:'markink-render-select',focus:false},'*');
      showCopyMenu(event.clientX,event.clientY);
    },true);
    if(selectDocument)diagram.addEventListener('click',(event)=>parent.postMessage({type:'markink-render-select',shiftKey:event.shiftKey},'*'));
    document.addEventListener('click',(event)=>{if(!menu.contains(event.target))menu.style.display='none'});
    menu.addEventListener('click',async(event)=>{
      const commandId=event.target?.dataset?.command;
      if(commandId){menu.style.display='none';parent.postMessage({type:'markink-render-command',commandId},'*');return;}
      const format=event.target?.dataset?.format;
      if(!format || copying)return;
      menu.style.display='none';error.textContent='';error.style.display='none';copying=true;
      try{
        const currentSource=getSource();
        const fence=String.fromCharCode(96).repeat(3);
        const value=format==='text'?fence+'mermaid\\n'+currentSource+'\\n'+fence:format==='png'?await pngData():await window.markinkOfficeDrawing(currentSource,diagram);
        const targetFormat=format==='powerpoint'?'office-drawing':format;
        if(new TextEncoder().encode(value).byteLength>16*1024*1024)throw new Error('コピーする図が大きすぎます');
        parent.postMessage({type:'markink-render-copy',format:targetFormat,value},'*');
      }catch(cause){copying=false;error.textContent=String(cause&&cause.message||cause);error.style.display='block';reportHeight()}
    });
    window.addEventListener('message',(event)=>{
      if(event.source!==parent || event.data?.type!=='markink-render-copy-result')return;
      copying=false;error.textContent=event.data.error||'';error.style.display=event.data.error?'block':'none';reportHeight();
    });
    window.addEventListener('message',async(event)=>{
      if(event.source!==parent||event.data?.type!=='markink-render-export')return;
      const requestId=event.data.requestId;
      if(typeof requestId!=='string'||!['office-drawing','png'].includes(event.data.format))return;
      try{
        const value=event.data.format==='png'?await pngData():await window.markinkOfficeDrawing(getSource(),diagram);
        parent.postMessage({type:'markink-render-export-result',requestId,value},'*');
      }catch(cause){parent.postMessage({type:'markink-render-export-result',requestId,error:String(cause&&cause.message||cause)},'*');}
    });
`;}

function renderHtml(bundle, officeDrawingSource) {
  const library = JSON.stringify(`${bundle}\n${officeDrawingSource}`).replace(/</g, '\\u003c');
  return `<meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#fff;color:#334155;font:13px Meiryo,sans-serif;overflow:auto}
    #diagram svg{display:block;max-width:100%;height:auto;margin:auto}
    #error{color:#b91c1c;white-space:pre-wrap;overflow-wrap:anywhere}
    ${copyStyle()}
  </style><div id="diagram"></div><div id="error"></div><div id="copy-menu"><button data-command="edit-mermaid">図を編集</button><button data-format="text">マークダウンコピー</button><button data-format="powerpoint">書式付きコピー</button><button data-format="png">PNG画像コピー</button></div><script>
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
  await api.openEditor(existing ? 'Mermaid図をビジュアル編集' : 'Mermaid図をビジュアル作成', editorHtml(source, browserBundle), apply);
}


let visualTemplate = '';
let visualScript = '';
let visualBundle = '';

function editorHtml(source, bundle) {
  const safeJson = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  // Export from a fresh, undecorated Mermaid SVG, never from zoomed UI chrome.
  const clipboard = copyScript()
    .replace('async function pngData(){', 'async function pngData(copyDiagram=diagram){')
    .replace("const svg=diagram.querySelector('svg');", "const svg=copyDiagram.querySelector('svg');")
    .replace('const currentSource=getSource();', 'const currentSource=getSource(); const copyDiagram=await prepareCopy(currentSource);')
    .replace('await pngData()', 'await pngData(copyDiagram)')
    .replace('markinkOfficeDrawing(currentSource,diagram)', 'markinkOfficeDrawing(currentSource,copyDiagram)')
    .replace('reportHeight()}\n    });', 'reportHeight()}finally{copySurface.replaceChildren()}\n    });');
  const library = `${bundle}\n${officeDrawingSource}\n${visualBundle}`;
  return visualTemplate
    .replace('%%COPY_STYLE%%', () => copyStyle())
    .replace('%%SCRIPT%%', () => `<script>const initial=${safeJson(source)};const library=${safeJson(library)};\n${visualScript}\n${clipboard}</script>`);
}

self.markinkPlugin = {
  async activate(api) {
    browserBundle = await api.readPackageText('mermaid.bundle.js');
    visualBundle = await api.readPackageText('wysiwyg.bundle.js');
    visualTemplate = await api.readPackageText('visual-editor.html');
    visualScript = await api.readPackageText('visual-editor.js');
    officeDrawingSource = '';
    for (const name of ['office-drawing.js', 'sequence-office-drawing.js', 'state-office-drawing.js', 'pie-office-drawing.js', 'architecture-office-drawing.js']) {
      officeDrawingSource += '\n' + await api.readPackageText(name);
    }
    await api.registerCodeBlockRenderer('mermaid', renderHtml(browserBundle, officeDrawingSource)
      .replace('data-command="edit-mermaid"', 'data-command="edit-mermaid-wysiwyg"')
      .replace('>図を編集</button>', '>図をビジュアル編集</button>'));
    await api.registerCommand({ id: 'create-mermaid-wysiwyg', title: 'Mermaid図をビジュアル作成', placement: 'menu' }, () => edit(api, false));
    await api.registerCommand({ id: 'edit-mermaid-wysiwyg', title: 'Mermaid図をビジュアル編集', placement: 'menu', contextMenu: true }, () => edit(api, true));
  }
};
