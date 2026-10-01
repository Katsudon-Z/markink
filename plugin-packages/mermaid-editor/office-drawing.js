(() => {
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
    window.markinkOfficeDrawing=async function officeDrawing(source,diagram){
      const diagramType=window.markinkMermaid.detectType(source);
      if(!diagramType.startsWith('flowchart'))throw new Error('PowerPoint図はgraph/flowchart記法に対応しています');
      const svg=diagram.querySelector('svg');
      if(!svg)throw new Error('描画が完了していません');
      if(svg.querySelector('g.node image,g.node foreignObject'))throw new Error('画像を含む図はPowerPoint図形へ変換できません。PNG形式でコピーしてください');
      const parsed=await window.markinkMermaid.mermaidAPI.getDiagramFromText(source);
      const connections=new Map(parsed.db.getEdges().map(edge=>[edge.id,edge]));
      const vertexIds=[...parsed.db.getVertices()].map(([id,vertex])=>({id,domId:vertex.domId,type:vertex.icon?'icon':vertex.img?'image':vertex.type,text:vertex.text}));
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
        const dashParts=(css.strokeDasharray||'').match(/[0-9]*\.?[0-9]+/g)||[];
        return {fill:color(css.fill,'#FFFFFF'),stroke:color(css.stroke,'none'),strokeWidth:Math.min(100,Math.max(0,parseFloat(css.strokeWidth)||0)),dash:dashParts.some(part=>Number(part)>0)?'dot':'solid'};
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
      const rectangleVertices=({x,y,w,h})=>[[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
      const diamondVertices=({x,y,w,h})=>[[x+w/2,y],[x+w,y+h/2],[x+w/2,y+h],[x,y+h/2]];
      const simplifyOpen=(points,tolerance)=>{
        if(points.length<=2)return points;
        const a=points[0],b=points[points.length-1],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
        let farthest=0,index=-1;
        for(let i=1;i<points.length-1;i++){
          const p=points[i],t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
          const distance=(p[0]-a[0]-dx*t)**2+(p[1]-a[1]-dy*t)**2;
          if(distance>farthest){farthest=distance;index=i}
        }
        if(farthest<=tolerance*tolerance)return [a,b];
        return [...simplifyOpen(points.slice(0,index+1),tolerance).slice(0,-1),...simplifyOpen(points.slice(index),tolerance)];
      };
      const polygonVertices=(points,tolerance)=>{
        if(points.length<3)return [];
        let split=1,farthest=0;
        for(let i=1;i<points.length;i++){
          const distance=(points[i][0]-points[0][0])**2+(points[i][1]-points[0][1])**2;
          if(distance>farthest){farthest=distance;split=i}
        }
        const first=simplifyOpen(points.slice(0,split+1),tolerance);
        const second=simplifyOpen([...points.slice(split),points[0]],tolerance);
        const vertices=[...first.slice(0,-1),...second.slice(0,-1)];
        return vertices.length>=3&&vertices.length<=32?vertices:[];
      };
      const shapes=[];
      const shapeElements=new Map();
      const shapeVertices=new WeakMap();
      const polygonTypes=new Set(['hex','hexagon','trap-b','trap-t','trapezoid','inv_trapezoid','lean-r','lean-l','lean_right','lean_left','odd']);
      const addShape=(element,label,layer,nodeId,semanticType)=>{
        const tag=element.tagName.toLowerCase();
        const box=bounds(svg,element);
        if(!(box.w>0&&box.h>0))return false;
        const rounded=tag==='rect'&&(parseFloat(element.getAttribute('rx'))>0||parseFloat(element.getAttribute('ry'))>0);
        const isRectangle=semanticType==='square'||semanticType==='rect'||semanticType==='squareRect'||Boolean(nodeId&&semanticType==null)||tag==='rect'&&!rounded;
        const isDiamond=['diamond','diam','decision','question'].includes(semanticType);
        const nativeKind={round:'roundRect',subroutine:'flowChartPredefinedProcess',cylinder:'can'}[semanticType];
        const kind=nativeKind|| (isDiamond?'freeform':tag==='ellipse'||tag==='circle'?'ellipse':isRectangle?'rectangle':'freeform');
        const polygonPoints=tag==='polygon'?Array.from({length:element.points.numberOfItems},(_,i)=>{
          const point=element.points.getItem(i);
          return localPoint(element,point.x,point.y);
        }):null;
        const isAsymmetric=['odd','rect_left_inv_arrow'].includes(semanticType);
        const asymmetricPoints=[[box.x,box.y],[box.x+box.h/4,box.y+box.h/2],[box.x,box.y+box.h],[box.x+box.w,box.y+box.h],[box.x+box.w,box.y]];
        const points=isAsymmetric?asymmetricPoints:isDiamond?diamondVertices(box):kind==='freeform'?(polygonPoints||outline(element)):[];
        if(kind==='freeform'&&points.length<3)return false;
        const shape={...box,kind,label,points,...style(element),layer,nodeId};
        shapes.push(shape);
        if(isDiamond||isAsymmetric)shapeVertices.set(shape,points);
        else if(isRectangle)shapeVertices.set(shape,rectangleVertices(box));
        else if(polygonPoints)shapeVertices.set(shape,polygonPoints);
        else if(polygonTypes.has(semanticType))shapeVertices.set(shape,polygonVertices(points,Math.min(box.w,box.h)*0.015));
        else if(kind==='freeform'&&tag==='path'){
          const vertices=polygonVertices(points,Math.min(box.w,box.h)*0.008);
          if(vertices.length>=3&&vertices.length<=12)shapeVertices.set(shape,vertices);
        }
        if(nodeId)shapeElements.set(nodeId,element);
        return true;
      };
      for(const cluster of svg.querySelectorAll('g.cluster')){
        const shape=cluster.querySelector(':scope > rect,:scope > polygon,:scope > path');
        if(shape)addShape(shape,'','background',cluster.getAttribute('data-id')||cluster.id,null);
        const title=cluster.querySelector('.cluster-label');
        if(title){const box=bounds(svg,title);if(box.w>0&&box.h>0)shapes.push({...box,kind:'rectangle',label:title.textContent.trim().slice(0,1000),fill:'none',stroke:'none',layer:'background'});}
      }
      for(const node of svg.querySelectorAll('g.node')){
        const elements=[...node.querySelectorAll('rect,ellipse,circle,polygon,path')].filter(item=>!item.closest('.label'));
        const vertex=vertexIds.find(item=>node.id===item.domId||node.id.endsWith('-'+item.domId));
        const domLabel=(node.querySelector('.label')||node).textContent.trim();
        const label=(domLabel||String(vertex?.text||'')).trim().slice(0,1000);
        const nodeId=node.getAttribute('data-id')||vertex?.id||null;
        let primaryAdded=false;
        for(const element of elements){
          const primary=!primaryAdded;
          if(addShape(element,primary?label:'','foreground',primary?nodeId:null,primary?vertex?.type:null)){
            primaryAdded=true;
            if(vertex?.type==='stadium'||vertex?.type==='odd'){
              const shape=shapes[shapes.length-1];
              for(const detail of elements){
                if(detail===element)continue;
                const detailStyle=style(detail);
                if(shape.fill==='none'&&detailStyle.fill!=='none')shape.fill=detailStyle.fill;
                if(shape.stroke==='none'&&detailStyle.stroke!=='none'){
                  shape.stroke=detailStyle.stroke;
                  shape.strokeWidth=detailStyle.strokeWidth;
                  shape.dash=detailStyle.dash;
                }
              }
              break;
            }
          }
        }
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
        const arrow=(value)=>!value||value==='none'?'none':/cross/i.test(value)?'cross':/circle/i.test(value)?'oval':/diamond/i.test(value)?'diamond':'triangle';
        const appearance=style(path);
        const connection=connections.get(path.getAttribute('data-id'))||[...connections].find(([id])=>path.id.endsWith('-'+id))?.[1];
        edges.push({points,stroke:appearance.stroke,strokeWidth:appearance.strokeWidth,dash:appearance.dash,startArrow:arrow(marker('start')),endArrow:arrow(marker('end')),startNode:nodeIds.has(connection?.start)?connection.start:null,endNode:nodeIds.has(connection?.end)?connection.end:null});
      }
      if(connections.size&&edges.length&&!edges.some(edge=>edge.startNode||edge.endNode))throw new Error('Mermaidの接続情報を図形に対応付けられません');
      const ports=new Map();
      for(const edge of edges){
        for(const side of ['start','end']){
          const id=edge[side+'Node'];
          if(!id)continue;
          if(!ports.has(id))ports.set(id,[]);
          ports.get(id).push({edge,side,point:edge.points[side==='start'?0:edge.points.length-1]});
        }
      }
      const nearestPreset=(shape,point)=>{
        const {x,y,w,h}=shape;
        const sites=[[x+w/2,y],[x,y+h/2],[x+w/2,y+h],[x+w,y+h/2]];
        let index=0,distance=Infinity;
        sites.forEach((site,i)=>{
          const d=(point[0]-site[0])**2+(point[1]-site[1])**2;
          if(d<distance){distance=d;index=i}
        });
        return {index,distance};
      };
      const projectToOutline=(points,point)=>{
        let nearest=point,distance=Infinity;
        for(let i=0;i<points.length;i++){
          const a=points[i],b=points[(i+1)%points.length];
          const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
          const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
          const p=[a[0]+dx*t,a[1]+dy*t];
          const d=(point[0]-p[0])**2+(point[1]-p[1])**2;
          if(d<distance){distance=d;nearest=p}
        }
        return nearest;
      };
      for(const shape of shapes){
        const attached=ports.get(shape.nodeId);
        if(!attached?.length)continue;
        const preset=attached.map(port=>nearestPreset(shape,port.point));
        if(['roundRect','flowChartPredefinedProcess','can'].includes(shape.kind)&&!attached.some(port=>port.edge[port.side+'Arrow']==='cross')){
          attached.forEach((port,i)=>{port.edge[port.side+'Site']=preset[i].index});
          continue;
        }
        const needsCustom=attached.some(port=>port.edge[port.side+'Arrow']==='cross')||preset.some(site=>site.distance>2.25)||attached.some((port,i)=>attached.slice(0,i).some((other,j)=>preset[i].index===preset[j].index&&Math.hypot(port.point[0]-other.point[0],port.point[1]-other.point[1])>1.5));
        if(!needsCustom){attached.forEach((port,i)=>{port.edge[port.side+'Site']=preset[i].index});continue}
        if(shape.kind!=='freeform'){
          shape.points=shapeVertices.get(shape)||outline(shapeElements.get(shape.nodeId));
          if(shape.points.length<3)throw new Error('図形の接続点を作成できません');
          shape.kind='freeform';
        }
        shape.connectionSites=[];
        attached.forEach(port=>{
          const site=projectToOutline(shape.points,port.point);
          port.edge[port.side+'Site']=shape.connectionSites.length;
          shape.connectionSites.push(site);
          port.edge.points[port.side==='start'?0:port.edge.points.length-1]=site;
        });
      }
      for(const shape of shapes){
        if(shape.kind!=='freeform')continue;
        const {x,y,w,h}=shape;
        const standard=[[x+w/2,y],[x,y+h/2],[x+w/2,y+h],[x+w,y+h/2]];
        const vertices=shapeVertices.get(shape)||[];
        const hadDynamic=Boolean(shape.connectionSites?.length);
        shape.connectionSites??=[];
        const addSite=(point,required=false)=>{
          const site=projectToOutline(shape.points,point);
          if(required||!shape.connectionSites.some(existing=>Math.hypot(existing[0]-site[0],existing[1]-site[1])<0.75))shape.connectionSites.push(site);
        };
        for(const point of standard)addSite(point,!hadDynamic);
        for(let i=0;i<vertices.length;i++){
          addSite(vertices[i]);
          const next=vertices[(i+1)%vertices.length];
          addSite([(vertices[i][0]+next[0])/2,(vertices[i][1]+next[1])/2]);
        }
        for(const port of ports.get(shape.nodeId)||[]){
          if(port.edge[port.side+'Arrow']!=='cross')continue;
          const center=port.edge.points[port.side==='start'?0:port.edge.points.length-1];
          const half=4;
          const corners=[[center[0]-half,center[1]-half],[center[0]+half,center[1]+half],[center[0]-half,center[1]+half],[center[0]+half,center[1]-half]];
          port.edge[port.side+'CrossSites']=corners.map(point=>{const index=shape.connectionSites.length;shape.connectionSites.push(point);return index});
        }
        if(shape.connectionSites.length>1024)throw new Error('図形の接続点が多すぎます');
      }
      const labels=[...svg.querySelectorAll('.edgeLabel')].map((item)=>{
        const box=bounds(svg,item);
        return {x:box.x-5,y:box.y-3,w:box.w+10,h:box.h+6,label:item.textContent.trim().slice(0,1000)};
      }).filter((item)=>item.label&&item.w>0);
      const viewBox=svg.viewBox.baseVal;
      return JSON.stringify({minX:viewBox.x,minY:viewBox.y,width:viewBox.width||svg.getBoundingClientRect().width,height:viewBox.height||svg.getBoundingClientRect().height,shapes,lines:edges,texts:labels});
    };
})();
