import type { OfficeDrawing, OfficeShape, OfficeRun } from './officeDocument';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const number = (value: unknown) => { const v = Number(value); if (!Number.isFinite(v) || Math.abs(v) >= 100000) throw new Error('図形の座標が不正です'); return Math.round(v * 100) / 100; };
const coordinate = (value: unknown) => Math.round(number(value));
const color = (value: unknown, fallback = '#000000') => /^#[a-f0-9]{6}$/i.test(String(value)) ? String(value) : fallback;
const family = (value: unknown) => escape(JSON.stringify(String(value || 'Aptos')));
let groupSequence = 0;
const textHtml = (shape: OfficeShape) => {
  const run = (r: OfficeRun) => `<span style="font-family:${family(r.fontFamily)};font-size:${number(r.fontSize)}px;color:${color(r.textColor)};${r.bold?'font-weight:bold;':''}${r.italic?'font-style:italic;':''}${r.underline?'text-decoration:underline;':''}">${escape(r.text)}</span>`;
  return shape.paragraphs?.length ? shape.paragraphs.map(p=>`<p style="margin:0">${p.runs.map(run).join('')}</p>`).join('') : `<p style="margin:0;text-align:${shape.align==='left'?'left':'center'};font-family:${family(shape.fontFamily)};font-size:${number(shape.fontSize||16)}px;color:${color(shape.textColor)};${shape.bold?'font-weight:bold;':''}${shape.italic?'font-style:italic;':''}">${escape(shape.label).replace(/\n/g,'<br>')}</p>`;
};
// Office's HTML importer uses VML for editable drawings; the GVML representation is
// published alongside this HTML for applications that prefer DrawingML.
export function drawingHtml(drawing: OfficeDrawing): string {
  let id = 0;
  const prefix = `markink-office-${++groupSequence}-`;
  const shape = (s: OfficeShape): string => {
    const w=number(s.w),h=number(s.h),x=number(s.x-drawing.minX),y=number(s.y-drawing.minY);
    const style=`position:absolute;left:${x};top:${y};width:${w};height:${h}${s.rotation?';rotation:'+number(s.rotation):''}`;
    const common=`id="${prefix}${++id}" style="${style}" filled="${s.fill==='none'?'f':'t'}" fillcolor="${color(s.fill,'#FFFFFF')}" stroked="${s.stroke==='none'?'f':'t'}" strokecolor="${color(s.stroke,'#334155')}" strokeweight="${number(s.strokeWidth??1)}px"`;
    const fill=`<v:fill opacity="${number(s.fillOpacity??1)}"/>`;
    const stroke=`<v:stroke opacity="${number(s.strokeOpacity??1)}" dashstyle="${s.dash==='solid'||!s.dash?'solid':s.dash==='dot'?'dot':'dash'}"/>`;
    const text=s.label||s.paragraphs?.length?`<v:textbox inset="0,0,0,0"><div>${textHtml(s)}</div></v:textbox>`:'';
    if(s.kind==='ellipse')return `<v:oval ${common}>${fill}${stroke}${text}</v:oval>`;
    if(s.kind==='roundRect')return `<v:roundrect ${common} arcsize="0.15">${fill}${stroke}${text}</v:roundrect>`;
    if(s.kind==='can')return `<v:shape ${common} coordsize="21600,21600" path="m 0,2700 c 0,-900,21600,-900,21600,2700 l 21600,18900 c 21600,22500,0,22500,0,18900 x m 0,2700 c 0,6300,21600,6300,21600,2700 e">${fill}${stroke}${text}</v:shape>`;
    if(s.kind==='flowChartPredefinedProcess')return `<v:rect ${common}>${fill}${stroke}${text}</v:rect><v:shape id="${prefix}${++id}" style="${style}" coordsize="21600,21600" path="m 2700,0 l 2700,21600 m 18900,0 l 18900,21600 e" filled="f" strokecolor="${color(s.stroke,'#334155')}" strokeweight="${number(s.strokeWidth??1)}px">${stroke}</v:shape>`;
    if(s.kind==='bullseye')return `<v:oval ${common.replace(/filled="[^"]*"/,'filled="f"')}>${stroke}</v:oval><v:oval id="${prefix}${++id}" style="position:absolute;left:${number(x+w*.3214)};top:${number(y+h*.3214)};width:${number(w*.3572)};height:${number(h*.3572)}" fillcolor="${color(s.fill)}" stroked="f">${fill}</v:oval>`;
    let points=s.points;
    if(s.kind==='diamond')points=[[s.x+w/2,s.y],[s.x+w,s.y+h/2],[s.x+w/2,s.y+h],[s.x,s.y+h/2]];
    if(points?.length){
      const p=points.map(p=>[Math.round((p[0]-s.x)/s.w*21600),Math.round((p[1]-s.y)/s.h*21600)]);
      const path=`m ${p[0].join(',')} l ${p.slice(1).map(p=>p.join(',')).join(',')} ${s.pathClosed===false?'':'x'} e`;
      return `<v:shape ${common} coordsize="21600,21600" path="${path}">${fill}${stroke}${text}</v:shape>`;
    }
    return `<v:rect ${common}>${fill}${stroke}${text}</v:rect>`;
  };
  const shapes=[...drawing.shapes,...drawing.texts.map(s=>({...s,fill:'none',stroke:'none'}))].map(shape).join('');
  const lines=drawing.lines.map(line=>{
    if(!line.points?.length)return '';
    const p=line.points.map(p=>[coordinate(p[0]-drawing.minX),coordinate(p[1]-drawing.minY)]);
    const path=`m ${p[0].join(',')} l ${p.slice(1).map(p=>p.join(',')).join(',')} e`;
    const arrow=(value:unknown)=>({triangle:'block',oval:'oval',diamond:'diamond',arrow:'open'}[String(value)]||'none');
    let result=`<v:shape id="${prefix}${++id}" style="position:absolute;left:0;top:0;width:${coordinate(drawing.width)};height:${coordinate(drawing.height)}" coordsize="${coordinate(drawing.width)},${coordinate(drawing.height)}" path="${path}" filled="f" strokecolor="${color(line.stroke,'#334155')}" strokeweight="${number(line.strokeWidth??1)}px"><v:stroke opacity="${number(line.strokeOpacity??1)}" dashstyle="${line.dash&&line.dash!=='solid'?'dash':'solid'}" startarrow="${arrow(line.startArrow)}" endarrow="${arrow(line.endArrow)}"/></v:shape>`;
    for(const [value,point] of [[line.startArrow,p[0]],[line.endArrow,p[p.length-1]]] as const)if(value==='cross'){
      const cross=`m ${point[0]-4},${point[1]-4} l ${point[0]+4},${point[1]+4} m ${point[0]-4},${point[1]+4} l ${point[0]+4},${point[1]-4} e`;
      result+=`<v:shape id="${prefix}${++id}" style="position:absolute;left:0;top:0;width:${coordinate(drawing.width)};height:${coordinate(drawing.height)}" coordsize="${coordinate(drawing.width)},${coordinate(drawing.height)}" path="${cross}" filled="f" strokecolor="${color(line.stroke,'#334155')}" strokeweight="${number(line.strokeWidth??1)}px"/>`;
    }
    return result;
  }).join('');
  return `<v:group xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" style="position:relative;width:${number(drawing.width)}px;height:${number(drawing.height)}px" coordorigin="0,0" coordsize="${coordinate(drawing.width)},${coordinate(drawing.height)}">${shapes}${lines}</v:group>`;
}

export async function imagePng(image: HTMLImageElement): Promise<string> {
  if (!image.complete || !image.naturalWidth) await image.decode();
  if (!image.naturalWidth || image.naturalWidth*image.naturalHeight>20000000) throw new Error('画像が大きすぎるか読み込めません');
  const canvas=document.createElement('canvas'); canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image,0,0);
  try { return canvas.toDataURL('image/png'); } catch { throw new Error('この画像はコピーできません。画像を文書に保存してから再度コピーしてください'); }
}

export async function svgOfficeDrawing(src: string): Promise<OfficeDrawing> {
  const comma=src.indexOf(',');
  const xml=src.slice(0,comma).includes(';base64')?new TextDecoder().decode(Uint8Array.from(atob(src.slice(comma+1)),c=>c.charCodeAt(0))):decodeURIComponent(src.slice(comma+1));
  const parsed=new DOMParser().parseFromString(xml,'image/svg+xml');
  const svg=parsed.documentElement;
  if(svg.localName!=='svg'||parsed.querySelector('parsererror'))throw new Error('SVG図形のデータが不正です');
  if(svg.querySelector('image,foreignObject,use')||/url\(\s*['"]?(?!#)/i.test(xml)||/@import/i.test(xml))throw new Error('外部画像・参照を含むSVGは書式付き図形へ変換できません');
  svg.querySelectorAll('script,animate,animateTransform,set').forEach(e=>e.remove());
  for(const element of [svg,...svg.querySelectorAll('*')]) for(const attr of [...element.attributes]) if(/^on/i.test(attr.name))element.removeAttribute(attr.name);
  const host=document.createElement('iframe');host.style.cssText='position:fixed;left:-100000px;top:0;visibility:hidden;width:1600px;height:1600px';host.setAttribute('sandbox','allow-same-origin');
  const ready = new Promise<void>((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('SVG図形の読み込みが完了しません')),10000);host.onload=()=>{clearTimeout(timer);resolve()}; });
  host.srcdoc='<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'">'+new XMLSerializer().serializeToString(svg);document.body.append(host);
  try {
    await ready;
    const root=host.contentDocument!.querySelector('svg')!,viewBox=root.viewBox.baseVal;
    const width=viewBox.width||parseFloat(root.getAttribute('width')||'800'),height=viewBox.height||parseFloat(root.getAttribute('height')||'500');
    root.setAttribute('width',String(width));root.setAttribute('height',String(height));
    const drawing: OfficeDrawing={minX:viewBox.x,minY:viewBox.y,width,height,shapes:[],lines:[],texts:[]};
    const rootMatrix=root.getScreenCTM();if(!rootMatrix)throw new Error('SVG図形の配置を取得できません');
    const paint=(value:string)=>{if(value==='none')return {color:'none',alpha:0};if(value.startsWith('url('))throw new Error('グラデーションを含むSVG図形は書式付きコピーに未対応です');const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const c=canvas.getContext('2d')!;c.fillStyle=value;c.fillRect(0,0,1,1);const p=c.getImageData(0,0,1,1).data;return {color:'#'+[...p.slice(0,3)].map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(),alpha:p[3]/255}};
    for(const element of root.querySelectorAll<SVGGraphicsElement>('rect,ellipse,circle,polygon,polyline,line,path,text')) {
      if(element.closest('defs,marker,clipPath,mask')||element.closest('text')!==element&&element.localName==='text')continue;
      const css=getComputedStyle(element);if(css.display==='none')continue;
      const matrix=element.getScreenCTM();if(!matrix)continue;
      const transform=(x:number,y:number)=>{const p=new DOMPoint(x,y).matrixTransform(matrix).matrixTransform(rootMatrix.inverse());return [p.x,p.y]};
      const b=element.getBBox(),a=transform(b.x,b.y),z=transform(b.x+b.width,b.y+b.height);
      const x=Math.min(a[0],z[0]),y=Math.min(a[1],z[1]),w=Math.max(.01,Math.abs(z[0]-a[0])),h=Math.max(.01,Math.abs(z[1]-a[1]));
      const fill=paint(css.fill),stroke=paint(css.stroke);
      let opacity=1;for(let e:Element|null=element;e;e=e.parentElement)opacity*=Number(getComputedStyle(e).opacity||1);
      const appearance={fill:fill.color,stroke:stroke.color,strokeWidth:Math.min(100,Math.max(0,parseFloat(css.strokeWidth)||0)),fillOpacity:fill.alpha*Number(css.fillOpacity||1)*opacity,strokeOpacity:stroke.alpha*Number(css.strokeOpacity||1)*opacity};
      if(element.localName==='text') { drawing.shapes.push({x,y,w:w+10,h:h+6,kind:'rectangle',label:element.textContent||'',fill:'none',stroke:'none',fontSize:Math.max(1,Math.min(200,parseFloat(css.fontSize)||16)),fontFamily:css.fontFamily.split(',')[0].replace(/['"]/g,''),textColor:fill.color,textOpacity:appearance.fillOpacity,bold:Number(css.fontWeight)>=600,italic:css.fontStyle==='italic'});continue; }
      if(element.localName==='line') { const e=element as SVGLineElement;drawing.lines.push({points:[transform(e.x1.baseVal.value,e.y1.baseVal.value),transform(e.x2.baseVal.value,e.y2.baseVal.value)],...appearance});continue; }
      const kind=element.localName==='rect'?(Number(element.getAttribute('rx'))>0?'roundRect':'rectangle'):['ellipse','circle'].includes(element.localName)?'ellipse':'freeform';
      let points:number[][]|undefined;
      if(kind==='freeform') {
        if(['polygon','polyline'].includes(element.localName)){const e=element as SVGPolygonElement;points=Array.from({length:e.points.numberOfItems},(_,i)=>{const p=e.points.getItem(i);return transform(p.x,p.y)});}
        else {const path=element as SVGPathElement,length=path.getTotalLength();points=Array.from({length:100},(_,i)=>{const p=path.getPointAtLength(length*i/99);return transform(p.x,p.y)});}
      }
      drawing.shapes.push({x,y,w,h,kind,label:'',points,pathClosed:element.localName!=='polyline'&&(element.localName!=='path'||/[zZ]\s*$/.test(element.getAttribute('d')||'')),...appearance});
    }
    return drawing;
  } finally {host.remove();}
}
