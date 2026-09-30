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
    #copy-menu{display:none;position:fixed;z-index:10;min-width:180px;padding:4px;background:#fff;border:1px solid #cbd5e1;border-radius:6px;box-shadow:0 4px 16px #0003}
    #copy-menu button{display:block;width:100%;border:0;background:none;text-align:left;padding:8px;cursor:pointer;font:13px Meiryo,sans-serif}
    #copy-menu button:hover{background:#e8f0ff}
  </style><div id="diagram"></div><div id="error"></div><div id="copy-menu"><button data-format="text">Mermaid記法</button><button data-format="powerpoint">PowerPoint図</button><button data-format="png">PNG</button></div><script>
    const diagram=document.getElementById('diagram');
    const error=document.getElementById('error');
    const menu=document.getElementById('copy-menu');
    const reportHeight=()=>parent.postMessage({type:'markink-render-height',height:document.body.scrollHeight+24},'*');
    const toPoint=(svg,x,y)=>{
      const matrix=svg.getScreenCTM();
      if(!matrix)throw new Error('図の位置を取得できません');
      const p=new DOMPoint(x,y).matrixTransform(matrix.inverse());
      return [p.x,p.y];
    };
    const bounds=(svg,element)=>{
      const r=element.getBoundingClientRect();
      const a=toPoint(svg,r.left,r.top),b=toPoint(svg,r.right,r.bottom);
      return {x:a[0],y:a[1],w:b[0]-a[0],h:b[1]-a[1]};
    };
    async function officeDrawing(){
      const diagramType=window.markinkMermaid.detectType(window.markinkCodeBlockSource);
      if(!diagramType.startsWith('flowchart'))throw new Error('PowerPoint図はgraph/flowchart記法に対応しています');
      const svg=diagram.querySelector('svg');
      if(!svg)throw new Error('描画が完了していません');
      if(svg.querySelector('g.node image,g.node foreignObject'))throw new Error('画像を含む図はPowerPoint図形へ変換できません。PNG形式でコピーしてください');
      const parsed=await window.markinkMermaid.mermaidAPI.getDiagramFromText(window.markinkCodeBlockSource);
      const connections=new Map(parsed.db.getEdges().map(edge=>[edge.id,edge]));
      const vertexIds=[...parsed.db.getVertices()].map(([id,vertex])=>({id,domId:vertex.domId}));
      const svgMatrix=svg.getScreenCTM();
      if(!svgMatrix)throw new Error('図の座標を取得できません');
      const localPoint=(element,x,y)=>{
        const matrix=element.getScreenCTM();
        if(!matrix)throw new Error('図形の座標を取得できません');
        const p=new DOMPoint(x,y).matrixTransform(matrix).matrixTransform(svgMatrix.inverse());
        return [p.x,p.y];
      };
      const color=(value,fallback)=>{
        if(!value||value==='none'||value==='transparent')return value==='none'||value==='transparent'?'none':fallback;
        const probe=document.createElement('span');probe.style.color=value;document.body.append(probe);
        const rgb=getComputedStyle(probe).color;probe.remove();
        const parts=rgb.match(/^rgba?[(]([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, /]+([0-9.]+))?[)]$/);
        if(parts){
          if(parts[4]==='0')return 'none';
          return '#'+parts.slice(1,4).map(part=>Number(part).toString(16).padStart(2,'0')).join('').toUpperCase();
        }
        return /^#[0-9a-f]{6}$/i.test(value)?value.toUpperCase():fallback;
      };
      const style=(element)=>{
        const css=getComputedStyle(element);
        return {fill:color(css.fill,'#FFFFFF'),stroke:color(css.stroke,'none'),strokeWidth:Math.min(100,Math.max(0,parseFloat(css.strokeWidth)||0)),dash:css.strokeDasharray&&css.strokeDasharray!=='none'?(css.strokeDasharray.split(/[ ,]+/).filter(Boolean).length>2?'dot':'dash'):'solid'};
      };
      const outline=(element)=>{
        const length=element.getTotalLength();
        if(!Number.isFinite(length)||length<=0)return [];
        const count=Math.max(8,Math.min(120,Math.ceil(length/8)));
        const points=[];
        for(let i=0;i<count;i++){
          const p=element.getPointAtLength(length*i/count);
          points.push(localPoint(element,p.x,p.y));
        }
        return points;
      };
      const shapes=[];
      const addShape=(element,label,layer,nodeId)=>{
        const tag=element.tagName.toLowerCase();
        const box=bounds(svg,element);
        if(!(box.w>0&&box.h>0))return;
        const rounded=tag==='rect'&&(parseFloat(element.getAttribute('rx'))>0||parseFloat(element.getAttribute('ry'))>0);
        const kind=tag==='ellipse'||tag==='circle'?'ellipse':tag==='rect'&&!rounded?'rectangle':'freeform';
        const points=kind==='freeform'?outline(element):[];
        if(kind==='freeform'&&points.length<3)return;
        shapes.push({...box,kind,label,points,...style(element),layer,nodeId});
      };
      for(const cluster of svg.querySelectorAll('g.cluster')){
        const shape=cluster.querySelector(':scope > rect,:scope > polygon,:scope > path');
        if(shape)addShape(shape,'','background',cluster.getAttribute('data-id')||cluster.id);
        const title=cluster.querySelector('.cluster-label');
        if(title){const box=bounds(svg,title);if(box.w>0&&box.h>0)shapes.push({...box,kind:'rectangle',label:title.textContent.trim().slice(0,1000),fill:'none',stroke:'none',layer:'background'});}
      }
      for(const node of svg.querySelectorAll('g.node')){
        const label=(node.querySelector('.label')||node).textContent.trim().slice(0,1000);
        const elements=[...node.querySelectorAll('rect,ellipse,circle,polygon,path')].filter(item=>!item.closest('.label'));
        const nodeId=node.getAttribute('data-id')||vertexIds.find(vertex=>node.id===vertex.domId||node.id.endsWith('-'+vertex.domId))?.id||null;
        elements.forEach((element,index)=>addShape(element,index===0?label:'','foreground',index===0?nodeId:null));
      }
      if(!shapes.length||shapes.length>200)throw new Error('PowerPoint図の図形数が範囲外です');
      const nodeIds=new Set(shapes.map(shape=>shape.nodeId).filter(Boolean));
      const edges=[];
      for(const path of svg.querySelectorAll('.edgePath path, path.flowchart-link')){
        if(typeof path.getTotalLength!=='function')continue;
        const length=path.getTotalLength();
        if(!Number.isFinite(length)||length<=0)continue;
        const points=[];
        const steps=Math.max(1,Math.min(24,Math.ceil(length/40)));
        for(let i=0;i<=steps;i++){
          const p=path.getPointAtLength(length*i/steps);
          points.push(localPoint(path,p.x,p.y));
        }
        const css=getComputedStyle(path);
        const marker=(side)=>path.getAttribute('marker-'+side)||css.getPropertyValue('marker-'+side)||'';
        const arrow=(value)=>!value||value==='none'?'none':/circle/i.test(value)?'oval':/diamond/i.test(value)?'diamond':'triangle';
        const appearance=style(path);
        const connection=connections.get(path.getAttribute('data-id'))||[...connections].find(([id])=>path.id.endsWith('-'+id))?.[1];
        edges.push({points,stroke:appearance.stroke,strokeWidth:appearance.strokeWidth,dash:appearance.dash,startArrow:arrow(marker('start')),endArrow:arrow(marker('end')),startNode:nodeIds.has(connection?.start)?connection.start:null,endNode:nodeIds.has(connection?.end)?connection.end:null});
      }
      if(connections.size&&edges.length&&!edges.some(edge=>edge.startNode||edge.endNode))throw new Error('Mermaidの接続情報を図形に対応付けられません');
      const labels=[...svg.querySelectorAll('.edgeLabel')].map((item)=>({...bounds(svg,item),label:item.textContent.trim().slice(0,1000)})).filter((item)=>item.label&&item.w>0);
      const viewBox=svg.viewBox.baseVal;
      return JSON.stringify({minX:viewBox.x,minY:viewBox.y,width:viewBox.width||svg.getBoundingClientRect().width,height:viewBox.height||svg.getBoundingClientRect().height,shapes,lines:edges,texts:labels});
    }
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
      menu.style.left=Math.max(0,Math.min(x,innerWidth-190))+'px';
      menu.style.top=Math.max(0,Math.min(y,innerHeight-116))+'px';
      menu.style.display='block';
    }
    document.addEventListener('contextmenu',(event)=>{
      if(!diagram.contains(event.target))return;
      event.preventDefault();
      parent.postMessage({type:'markink-render-select',focus:false},'*');
      showCopyMenu(event.clientX,event.clientY);
    },true);
    diagram.addEventListener('click',()=>parent.postMessage({type:'markink-render-select'},'*'));
    document.addEventListener('click',(event)=>{if(!menu.contains(event.target))menu.style.display='none'});
    menu.addEventListener('click',async(event)=>{
      const format=event.target?.dataset?.format;
      if(!format)return;
      menu.style.display='none';error.textContent='';
      try{
        const value=format==='text'?window.markinkCodeBlockSource:format==='png'?await pngData():await officeDrawing();
        const targetFormat=format==='powerpoint'?'office-drawing':format;
        if(value.length>16*1024*1024)throw new Error('コピーする図が大きすぎます');
        parent.postMessage({type:'markink-render-copy',format:targetFormat,value},'*');
      }catch(cause){error.textContent=String(cause&&cause.message||cause);reportHeight()}
    });
    window.addEventListener('message',(event)=>{
      if(event.data?.type!=='markink-render-copy-result')return;
      error.textContent=event.data.error||'';reportHeight();
    });
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
