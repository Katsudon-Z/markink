(() => {
  window.markinkArchitectureOfficeDrawing = async function(source, svg) {
    const parsed = await window.markinkMermaid.mermaidAPI.getDiagramFromText(source);
    const db = parsed.db;
    const matrix = svg.getScreenCTM();
    if (!matrix) throw new Error('図の座標を取得できません');
    const point = (element, x, y) => {
      const local = element.getScreenCTM();
      if (!local) throw new Error('図形の座標を取得できません');
      const p = new DOMPoint(x, y).matrixTransform(local).matrixTransform(matrix.inverse());
      return [p.x, p.y];
    };
    const box = element => {
      const r = element.getBoundingClientRect();
      const a = new DOMPoint(r.left, r.top).matrixTransform(matrix.inverse());
      const b = new DOMPoint(r.right, r.bottom).matrixTransform(matrix.inverse());
      return { x: a.x, y: a.y, w: Math.max(0.01, b.x - a.x), h: Math.max(0.01, b.y - a.y) };
    };
    const color = (value, fallback) => {
      if (!value) return fallback;
      if (value === 'none' || value === 'transparent') return 'none';
      const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe);
      const rgb = getComputedStyle(probe).color; probe.remove();
      const parts = rgb.match(/^rgba?[(]([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, /]+([0-9.]+))?[)]$/);
      if (!parts) return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
      if (parts[4] === '0') return 'none';
      return '#' + parts.slice(1, 4).map(p => Number(p).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const style = element => window.markinkOfficeStyle.shape(element, (()=>{const a=point(element,0,0),b=point(element,1,0);return Math.hypot(b[0]-a[0],b[1]-a[1])})());
    const visible = element => {
      const css = getComputedStyle(element);
      return !element.closest('defs,marker,clipPath,mask') && css.display !== 'none' && css.visibility !== 'hidden';
    };
    if (svg.querySelector('image,use')) throw new Error('画像・外部参照アイコンはPNG形式でコピーしてください');
    const shapes = [], lines = [], anchors = new Map();
    const rectPoints = b => [[b.x,b.y],[b.x+b.w,b.y],[b.x+b.w,b.y+b.h],[b.x,b.y+b.h]];
    const addSite = (shape, p) => {
      shape.kind = 'freeform'; shape.points = rectPoints(shape); shape.pathClosed = true;
      shape.connectionSites ||= [];
      const index = shape.connectionSites.findIndex(site => Math.hypot(site[0]-p[0],site[1]-p[1]) < 0.01);
      if (index >= 0) return index;
      shape.connectionSites.push(p); return shape.connectionSites.length - 1;
    };
    const addPrimitive = (element, groupId) => {
      if (!visible(element)) return null;
      const b = box(element), tag = element.tagName.toLowerCase(), ink = style(element);
      let kind = tag === 'rect' ? (Number(element.getAttribute('rx')) > 0 ? 'roundRect' : 'rectangle') : ['ellipse','circle'].includes(tag) ? 'ellipse' : 'freeform';
      let points = [], closed = true;
      if (tag === 'line') {
        points = [point(element,Number(element.getAttribute('x1')),Number(element.getAttribute('y1'))),point(element,Number(element.getAttribute('x2')),Number(element.getAttribute('y2')))]; closed = false;
      } else if (tag === 'polygon' || tag === 'polyline') {
        points = Array.from({length:element.points.numberOfItems},(_,i)=>{const p=element.points.getItem(i);return point(element,p.x,p.y)}); closed = tag === 'polygon';
      } else if (tag === 'path') {
        const d = element.getAttribute('d') || '';
        if ((d.match(/[Mm]/g)||[]).length > 1 && ink.fill !== 'none') throw new Error('複数輪郭の塗りを持つアイコンはPNG形式でコピーしてください');
        const length = element.getTotalLength();
        if (!(length > 0)) return null;
        const count = Math.min(120,Math.max(8,Math.ceil(length/2)));
        points = Array.from({length:count+1},(_,i)=>{const p=element.getPointAtLength(length*i/count);return point(element,p.x,p.y)});
        closed = /[Zz]\s*$/.test(d);
      }
      if (kind === 'freeform' && points.length < (closed?3:2)) return null;
      const shape = {...b,kind,points,pathClosed:closed,label:'',...ink,groupId};
      shapes.push(shape); return shape;
    };
    const addText = (element, groupId) => {
      const rows = [...element.querySelectorAll('tspan.text-outer')];
      const label = (rows.length?rows.map(row=>row.textContent).join('\n'):element.textContent).trim().slice(0,1000);
      if (!label || !visible(element)) return;
      const b=box(element), ink=[...element.querySelectorAll('tspan')].find(span=>span.textContent.trim())||element;
      const css=getComputedStyle(ink);
      const origin=point(element,0,0),axis=point(element,1,0),scale=Math.hypot(axis[0]-origin[0],axis[1]-origin[1]);
      const rotation=Math.atan2(axis[1]-origin[1],axis[0]-origin[0])*180/Math.PI;
      const local=typeof element.getBBox==='function'?element.getBBox():null;
      const w=local?local.width*scale+10:b.w+10,h=local?local.height*scale+6:b.h+6;
      shapes.push({x:b.x+b.w/2-w/2,y:b.y+b.h/2-h/2,w,h,rotation,kind:'rectangle',label,fill:'none',stroke:'none',...window.markinkOfficeStyle.text(element,scale),groupId});
    };
    const services = db.getServices(), junctions = db.getJunctions(), groups = db.getGroups();
    for (const group of groups) {
      const element = [...svg.querySelectorAll('.architecture-groups rect.node-bkg')].find(item=>item.id.endsWith('-group-'+group.id));
      if (!element) throw new Error('グループの配置を取得できません');
      const shape = addPrimitive(element,null); shape.layer='background';shape.nodeId='architecture-group-'+group.id;
      anchors.set(shape.nodeId,shape);
    }
    for (const node of [...services,...junctions]) {
      const groupId = 'architecture-node-'+node.id;
      const container = node.type === 'junction'
        ? [...svg.querySelectorAll('.architecture-junction')].find(item=>[...item.querySelectorAll('rect')].some(rect=>rect.id.endsWith('-node-'+node.id)))
        : [...svg.querySelectorAll('.architecture-service')].find(item=>item.id.endsWith('-service-'+node.id));
      if (!container) throw new Error('サービスの配置を取得できません');
      const elements=[...container.querySelectorAll('rect,ellipse,circle,path,line,polygon,polyline')].filter(visible);
      let anchor=null;
      for (const element of elements) {
        const shape=addPrimitive(element,groupId);
        if (!anchor && shape && (element.tagName.toLowerCase()==='rect' || element.classList.contains('node-bkg'))) anchor=shape;
      }
      if (!anchor) {
        const b=box(container.querySelector('svg')||container);
        anchor={...b,kind:'rectangle',label:'',fill:'none',stroke:'none',groupId};shapes.push(anchor);
      }
      anchor.nodeId=groupId;anchors.set(groupId,anchor);
      for (const text of container.querySelectorAll('text,foreignObject .node-icon-text > div')) addText(text,groupId);
    }
    for (const element of svg.querySelectorAll('.architecture-groups text')) addText(element,null);
    for (const element of svg.querySelectorAll('.architecture-groups path,.architecture-groups circle,.architecture-groups ellipse,.architecture-groups rect:not(.node-bkg),.architecture-groups line')) addPrimitive(element,null);
    const edgePaths=[...svg.querySelectorAll('.architecture-edges path.edge')];
    for (const edge of db.getEdges()) {
      const index=edgePaths.findIndex(path=>path.id.endsWith('-L_'+edge.lhsId+'_'+edge.rhsId+'_0'));
      if(index<0) throw new Error('接続線の配置を取得できません');
      const element=edgePaths.splice(index,1)[0];
      const coordinates=(element.getAttribute('d')||'').match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)?.map(Number)||[];
      const points=[];
      for(let i=0;i<coordinates.length;i+=2) points.push(point(element,coordinates[i],coordinates[i+1]));
      const ink=style(element);
      const line={points,...ink,startArrow:edge.lhsInto?'triangle':'none',endArrow:edge.rhsInto?'triangle':'none'};
      for(const [side,nodeId,isGroup] of [['start',edge.lhsId,edge.lhsGroup],['end',edge.rhsId,edge.rhsGroup]]) {
        const node=[...services,...junctions].find(item=>item.id===nodeId);
        const id=isGroup?'architecture-group-'+node?.in:'architecture-node-'+nodeId;
        const anchor=anchors.get(id);
        if(!anchor) throw new Error('接続先の図形を取得できません');
        line[side+'Node']=id;line[side+'Site']=addSite(anchor,points[side==='start'?0:points.length-1]);
      }
      lines.push(line);
      for(const text of element.parentElement.querySelectorAll('text')) addText(text,null);
    }
    for(const shape of anchors.values()) {
      if(shape.kind!=='freeform') continue;
      for(const p of [...rectPoints(shape),[shape.x+shape.w/2,shape.y],[shape.x,shape.y+shape.h/2],[shape.x+shape.w/2,shape.y+shape.h],[shape.x+shape.w,shape.y+shape.h/2]]) addSite(shape,p);
    }
    if(!shapes.length||shapes.length>200||lines.length>400) throw new Error('アーキテクチャ図の要素数が範囲外です');
    const view=svg.viewBox.baseVal;
    return JSON.stringify({minX:view.x,minY:view.y,width:view.width,height:view.height,shapes,lines,texts:[]});
  };
})();
