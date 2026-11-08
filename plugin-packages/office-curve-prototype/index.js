const cases = {
  arch: { title:'弧（同じ高さの両端）', start:[130,140], segments:[[[180,20],[280,20],[330,140]]], a:[20,120], b:[330,120], endSite:1 },
  s: { title:'S字（両端の高さが異なる）', start:[130,140], segments:[[[210,40],[250,300],[330,220]]], a:[20,120], b:[330,200], endSite:1 },
  u: { title:'U字（同じ側の接続点）', start:[130,60], segments:[[[350,60],[350,260],[130,260]]], a:[20,40], b:[20,240], endSite:3 },
  multiple: { title:'複数区間の曲線', start:[130,140], segments:[[[150,40],[210,40],[230,140]],[[250,240],[310,240],[330,140]]], a:[20,120], b:[330,120], endSite:1 }
};
function rectangle(id, position, label) {
  const [x,y]=position, w=110,h=40;
  return {x,y,w,h,kind:'freeform',label,nodeId:id,
    points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]],
    connectionSites:[[x+w/2,y],[x,y+h/2],[x+w/2,y+h],[x+w,y+h/2]],
    fill:'#ECECFF',stroke:'#9370DB',strokeWidth:1,fontSize:16,textColor:'#333333'};
}
function drawing(key, mode) {
  const example=cases[key], end=example.segments[example.segments.length-1][2];
  const line={points:[example.start,...example.segments.map(segment=>segment[2])],
    startNode:'A',endNode:'B',startSite:3,endSite:example.endSite,
    stroke:'#334155',strokeWidth:2,endArrow:'triangle'};
  if(mode!=='standard')line.bezierSegments=example.segments;
  if(mode==='detached'){
    delete line.startNode;delete line.endNode;delete line.startSite;delete line.endSite;
  }
  // Additional middle points let the standard converter recognize a curved line.
  if(mode==='standard')line.points=[example.start,example.segments[0][0],end];
  return {minX:0,minY:0,width:480,height:300,
    shapes:[rectangle('A',example.a,'接続元'),rectangle('B',example.b,'接続先')],lines:[line],texts:[]};
}
function html() {
  const data=JSON.stringify(cases).replace(/</g,'\\u003c');
  const drawings=JSON.stringify(Object.fromEntries(Object.keys(cases).map(key=>[key,Object.fromEntries(['custom','detached','standard'].map(mode=>[mode,drawing(key,mode)]))])));
  return `<!doctype html><html lang="ja"><meta charset="utf-8"><style>
    body{font:14px Meiryo,sans-serif;margin:16px;color:#334155}button,select{padding:8px;margin:4px;font:inherit}svg{width:100%;max-height:400px;border:1px solid #cbd5e1}#status{min-height:24px;white-space:pre-wrap}p{line-height:1.7}
    </style><h2>Office カスタム曲線コネクタ試作</h2><select id="case" aria-label="曲線の例"></select>
    <div id="preview"></div><button data-mode="custom">カスタム曲線・接続ありをコピー</button><button data-mode="detached">カスタム曲線・接続なしをコピー</button><button data-mode="standard">標準曲線・接続ありをコピー</button><div id="status" role="status"></div>
    <p>PowerPointへ貼り付け、①上の図との一致 ②線が1つのコネクタか ③接続元・接続先を動かした時の追従と曲がり方 ④図全体の拡大縮小 ⑤保存・再読込を確認してください。接続ありで形が変わる場合は、接続なしと比較してください。</p>
    <script>const cases=${data},drawings=${drawings};const select=document.getElementById('case'),status=document.getElementById('status');let busy=false;
    for(const [key,item] of Object.entries(cases))select.add(new Option(item.title,key));
    function render(){const item=cases[select.value];const nodes=drawings[select.value].custom.shapes;const path='M '+item.start.join(' ')+' '+item.segments.map(segment=>'C '+segment.map(point=>point.join(' ')).join(' ')).join(' ');
      document.getElementById('preview').innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 300"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 Z" fill="#334155"/></marker></defs>'+nodes.map(node=>'<rect x="'+node.x+'" y="'+node.y+'" width="110" height="40" fill="#ececff" stroke="#9370db"/><text x="'+(node.x+55)+'" y="'+(node.y+25)+'" text-anchor="middle" fill="#333">'+node.label+'</text>').join('')+'<path d="'+path+'" fill="none" stroke="#334155" stroke-width="2" marker-end="url(#arrow)"/></svg>';
    }select.addEventListener('change',render);render();
    for(const button of document.querySelectorAll('button[data-mode]'))button.addEventListener('click',()=>{if(busy)return;busy=true;status.textContent='コピー中…';for(const control of document.querySelectorAll('button'))control.disabled=true;parent.postMessage({type:'markink-render-copy',format:'office-drawing',value:JSON.stringify(drawings[select.value][button.dataset.mode])},'*')});
    window.addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='markink-render-copy-result')return;busy=false;for(const control of document.querySelectorAll('button'))control.disabled=false;status.textContent=event.data.error?'コピー失敗: '+event.data.error:'コピーしました。PowerPointへ貼り付けてください'});
    </script></html>`;
}
self.markinkPlugin={async activate(api){await api.registerCommand({id:'office-curve-prototype',title:'Officeカスタム曲線を試す',placement:'menu'},()=>api.openEditor('Officeカスタム曲線コネクタ試作',html()))}};
