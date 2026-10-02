(() => {
  // SVG provides the layout; Mermaid's database provides participant/message identities.
  window.markinkSequenceOfficeDrawing = async function(source, svg) {
    const parsed = await window.markinkMermaid.mermaidAPI.getDiagramFromText(source);
    const actors = parsed.db.getActors();
    const messages = new Map(parsed.db.getMessages().map(message => ['i' + message.id, message]));
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
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    };
    const color = (value, fallback) => {
      if (!value) return fallback;
      if (value === 'none' || value === 'transparent') return 'none';
      const probe = document.createElement('span');
      probe.style.color = value;
      document.body.append(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      const parts = rgb.match(/^rgba?[(]([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, /]+([0-9.]+))?[)]$/);
      if (!parts) return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
      if (parts[4] === '0') return 'none';
      return '#' + parts.slice(1, 4).map(p => Number(p).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const appearance = element => {
      const css = getComputedStyle(element);
      const segments = (css.strokeDasharray || '').match(/[0-9]*\.?[0-9]+/g) || [];
      return {
        fill: color(css.fill, 'none'), stroke: color(css.stroke, 'none'),
        fillOpacity: Math.min(1, Math.max(0, (Number(css.fillOpacity || 1)) * (Number(css.opacity || 1)) * (Number((css.fill || '').match(/^rgba\([^)]*,\s*([0-9.]+)\)$/)?.[1] || 1)))),
        strokeWidth: Math.min(100, Math.max(0, parseFloat(css.strokeWidth) || 0)),
        dash: segments.some(p => Number(p) > 0) ? 'dot' : 'solid'
      };
    };
    const textStyle = element => {
      // Mermaid sets the actor background on text.actor and the ink on its tspan.
      const ink = [...element.querySelectorAll('tspan')].find(span => span.textContent.trim()) || element;
      const css = getComputedStyle(ink);
      return { fontSize: Math.min(200, Math.max(1, parseFloat(css.fontSize) || 16)), textColor: color(css.fill, '#000000') };
    };
    const label = element => {
      const spans = [...element.querySelectorAll(':scope > tspan')];
      return (spans.length ? spans.map(span => span.textContent).join('\n') : element.textContent).trim().slice(0, 1000);
    };
    const rectangles = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    const pointsFor = element => {
      const tag = element.tagName.toLowerCase();
      if (tag === 'line') return [point(element, element.x1.baseVal.value, element.y1.baseVal.value), point(element, element.x2.baseVal.value, element.y2.baseVal.value)];
      if (tag === 'polygon' || tag === 'polyline') return Array.from({ length: element.points.numberOfItems }, (_, i) => {
        const p = element.points.getItem(i); return point(element, p.x, p.y);
      });
      const length = element.getTotalLength();
      if (!Number.isFinite(length) || length <= 0) return [];
      const count = Math.min(120, Math.max(8, Math.ceil(length / 5)));
      const result = [];
      for (let i = 0; i <= count; i++) {
        const p = element.getPointAtLength(length * i / count);
        result.push(point(element, p.x, p.y));
      }
      return result;
    };
    const arrow = (element, side) => {
      const value = element.getAttribute('marker-' + side) || getComputedStyle(element).getPropertyValue('marker-' + side);
      if (!value || value === 'none') return 'none';
      if (/crosshead/i.test(value)) return 'cross';
      if (/filled-head|stick.*ArrowHead/i.test(value)) return 'arrow';
      if (/arrowhead|solid.*ArrowHead/i.test(value)) return 'triangle';
      return 'none';
    };
    const visible = element => {
      if (element.closest('defs,marker,clipPath,mask,.actorPopupMenu')) return false;
      const css = getComputedStyle(element);
      return css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0';
    };
    if ([...svg.querySelectorAll('image,foreignObject')].some(visible)) throw new Error('画像・数式を含むシーケンス図はPNG形式でコピーしてください');
    const shapes = [], lines = [], texts = [];
    const lifelines = new Map(), activations = [], shapeElements = new Map();
    const addSite = (shape, p) => {
      shape.connectionSites ||= [];
      const existing = shape.connectionSites.findIndex(site => Math.hypot(site[0] - p[0], site[1] - p[1]) < 0.01);
      if (existing >= 0) return existing;
      if (shape.kind !== 'freeform') { shape.kind = 'freeform'; shape.points = rectangles(shape); shape.pathClosed = true; }
      shape.connectionSites.push(p);
      if (shape.connectionSites.length > 1024) throw new Error('図形の接続点が多すぎます');
      return shape.connectionSites.length - 1;
    };
    // Lifelines are editable open shapes and anchor message endpoints at their actual heights.
    for (const element of svg.querySelectorAll('line.actor-line')) {
      if (!visible(element)) continue;
      const id = element.getAttribute('data-id') || element.getAttribute('name');
      if (!id || !actors.has(id)) continue;
      const points = pointsFor(element), b = box(element);
      const shape = { ...b, w: Math.max(0.01, b.w), h: Math.max(0.01, b.h), kind: 'freeform', pathClosed: false, label: '', points, ...appearance(element), fill: 'none', nodeId: 'sequence-life-' + id, connectionSites: [] };
      shapes.push(shape); lifelines.set(id, shape); shapeElements.set(element, shape);
    }
    for (const element of svg.querySelectorAll('rect,ellipse,circle,polygon,path,polyline')) {
      if (!visible(element) || element.matches('[data-et="message"]')) continue;
      const b = box(element), tag = element.tagName.toLowerCase();
      if (!(b.w > 0 && b.h > 0)) continue;
      const style = appearance(element);
      if (style.fill === 'none' && style.stroke === 'none') continue;
      let kind = tag === 'rect' ? (Number(element.getAttribute('rx')) > 0 ? 'roundRect' : 'rectangle') : tag === 'circle' || tag === 'ellipse' ? 'ellipse' : 'freeform';
      const participant = element.closest('[data-et="participant"]');
      const databaseFooter = element.parentElement?.classList.contains('actor-bottom') && [...lifelines].some(([id, life]) => actors.get(id)?.type === 'database' && Math.abs(b.x + b.w / 2 - (life.x + life.w / 2)) < 3);
      if (tag === 'path' && (participant?.getAttribute('data-type') === 'database' || databaseFooter)) kind = 'can';
      const points = kind === 'freeform' ? pointsFor(element) : [];
      if (kind === 'freeform' && points.length < 2) continue;
      const closed = tag === 'polygon' || tag === 'path' && /z\s*$/i.test(element.getAttribute('d') || '');
      const shape = { ...b, kind, label: '', points, pathClosed: closed, ...style, layer: element.matches('rect.rect,rect.box') ? 'background' : 'foreground' };
      shapes.push(shape); shapeElements.set(element, shape);
      if (/activation/.test(element.getAttribute('class') || '')) {
        shape.nodeId = 'sequence-activation-' + activations.length;
        activations.push(shape);
      }
    }
    const attach = (edge, side, id, p) => {
      const active = [...activations].reverse().find(shape => p[1] >= shape.y && p[1] <= shape.y + shape.h && p[0] >= shape.x - 1 && p[0] <= shape.x + shape.w + 1);
      const shape = active || lifelines.get(id);
      if (!shape) return;
      edge[side + 'Node'] = shape.nodeId;
      edge[side + 'Site'] = addSite(shape, p);
      if (edge[side + 'Arrow'] === 'cross') {
        edge[side + 'CrossSites'] = [[p[0] - 4, p[1] - 4], [p[0] + 4, p[1] + 4], [p[0] - 4, p[1] + 4], [p[0] + 4, p[1] - 4]].map(corner => addSite(shape, corner));
      }
    };
    for (const element of svg.querySelectorAll('line,path[data-et="message"]')) {
      if (!visible(element) || shapeElements.has(element)) continue;
      const points = pointsFor(element);
      if (points.length < 2) continue;
      if (/sequencenumber/.test(element.getAttribute('marker-start') || '')) {
        const p = points[0], marker = svg.querySelector('marker[id$="-sequencenumber"] circle');
        shapes.push({ x: p[0] - 6, y: p[1] - 6, w: 12, h: 12, kind: 'ellipse', label: '', fill: marker ? appearance(marker).fill : '#000000', stroke: 'none' });
        continue;
      }
      if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 0.01) continue;
      const edge = { points: [points[0], points.at(-1)], ...appearance(element), startArrow: arrow(element, 'start'), endArrow: arrow(element, 'end') };
      if (edge.stroke === 'none') continue;
      const message = messages.get(element.getAttribute('data-id'));
      const from = element.getAttribute('data-from') || message?.from;
      const to = element.getAttribute('data-to') || message?.to;
      if (element.matches('[data-et="message"]')) {
        attach(edge, 'start', from, points[0]); attach(edge, 'end', to, points.at(-1));
      }
      if (element.tagName.toLowerCase() === 'path') {
        // A self-message remains one editable path instead of a stack of short lines.
        const b = box(element);
        shapes.push({ ...b, w: Math.max(0.01, b.w), h: Math.max(0.01, b.h), kind: 'freeform', label: '', pathClosed: false, points, ...appearance(element), fill: 'none', startArrow: edge.startArrow === 'cross' ? 'none' : edge.startArrow, endArrow: edge.endArrow === 'cross' ? 'none' : edge.endArrow });
        for (const side of ['start', 'end']) {
          if (edge[side + 'Arrow'] !== 'cross') continue;
          const p = points[side === 'start' ? 0 : points.length - 1];
          const sites = edge[side + 'CrossSites'];
          for (let diagonal = 0; diagonal < 2; diagonal++) {
            const offset = diagonal * 2;
            const corners = diagonal === 0 ? [[p[0] - 4, p[1] - 4], [p[0] + 4, p[1] + 4]] : [[p[0] - 4, p[1] + 4], [p[0] + 4, p[1] - 4]];
            lines.push({ points: corners, stroke: edge.stroke, strokeWidth: edge.strokeWidth, dash: 'solid', startNode: edge[side + 'Node'], endNode: edge[side + 'Node'], startSite: sites?.[offset], endSite: sites?.[offset + 1] });
          }
        }
      } else lines.push(edge);
    }
    for (const element of svg.querySelectorAll('text')) {
      if (!visible(element)) continue;
      const value = label(element), b = box(element);
      if (!value || !(b.w > 0 && b.h > 0)) continue;
      const owner = [...shapeElements].find(([primitive, shape]) => primitive.tagName.toLowerCase() === 'rect' && primitive.parentElement === element.parentElement && (element.classList.contains('actor') || element.classList.contains('noteText')) && b.x + b.w / 2 >= shape.x && b.x + b.w / 2 <= shape.x + shape.w && b.y + b.h / 2 >= shape.y && b.y + b.h / 2 <= shape.y + shape.h)?.[1];
      if (owner) { owner.label = [owner.label, value].filter(Boolean).join('\n'); Object.assign(owner, textStyle(element)); }
      else texts.push({ x: b.x - 5, y: b.y - 3, w: b.w + 10, h: b.h + 6, label: value, ...textStyle(element) });
    }
    for (const shape of lifelines.values()) {
      addSite(shape, shape.points[0]); addSite(shape, shape.points.at(-1));
    }
    for (const shape of activations) {
      if (shape.kind !== 'freeform') continue;
      const corners = rectangles(shape);
      corners.forEach((p, i) => {
        addSite(shape, p);
        const next = corners[(i + 1) % corners.length];
        addSite(shape, [(p[0] + next[0]) / 2, (p[1] + next[1]) / 2]);
      });
    }
    if (!shapes.length || shapes.length > 200 || lines.length > 400 || texts.length > 400) throw new Error('シーケンス図の要素数が範囲外です');
    const view = svg.viewBox.baseVal;
    return JSON.stringify({ minX: view.x, minY: view.y, width: view.width, height: view.height, shapes, lines, texts });
  };
})();
