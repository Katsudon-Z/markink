(() => {
  window.markinkPieOfficeDrawing = async function(source, svg) {
    await window.markinkMermaid.mermaidAPI.getDiagramFromText(source);
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
      probe.style.color = value; document.body.append(probe);
      const rgb = getComputedStyle(probe).color; probe.remove();
      const parts = rgb.match(/^rgba?[(]([0-9]+)[, ]+([0-9]+)[, ]+([0-9]+)(?:[, /]+([0-9.]+))?[)]$/);
      if (!parts) return /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : fallback;
      if (parts[4] === '0') return 'none';
      return '#' + parts.slice(1, 4).map(p => Number(p).toString(16).padStart(2, '0')).join('').toUpperCase();
    };
    const style = element => window.markinkOfficeStyle.shape(element);
    const visible = element => {
      const css = getComputedStyle(element);
      return !element.closest('defs,marker,clipPath,mask') && css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0';
    };
    // Sample each arc separately so the radial edges keep their exact corner points.
    const outline = element => {
      const commands = (element.getAttribute('d') || '').match(/[MLAZ][^MLAZ]*/g) || [];
      if (!commands.length) throw new Error('扇形の輪郭を取得できません');
      const arcs = commands.filter(command => command[0] === 'A').length;
      const steps = Math.max(8, Math.floor((124 - commands.length) / Math.max(1, arcs)));
      const points = [];
      let current = [0, 0];
      for (const command of commands) {
        const values = (command.slice(1).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) || []).map(Number);
        if (command[0] === 'M' || command[0] === 'L') {
          current = values.slice(-2); points.push(point(element, ...current));
        } else if (command[0] === 'A') {
          const segment = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          segment.setAttribute('d', 'M' + current.join(',') + command);
          const length = segment.getTotalLength();
          const count = Math.min(steps, Math.max(2, Math.ceil(length / 4)));
          for (let i = 1; i <= count; i++) {
            const p = segment.getPointAtLength(length * i / count);
            points.push(point(element, p.x, p.y));
          }
          current = values.slice(-2);
        }
      }
      return points;
    };
    const shapes = [], texts = [];
    for (const element of svg.querySelectorAll('circle.pieOuterCircle,path.pieCircle,.legend rect')) {
      if (!visible(element)) continue;
      const b = box(element);
      if (!(b.w > 0 && b.h > 0)) continue;
      const tag = element.tagName.toLowerCase();
      let kind = tag === 'circle' ? 'ellipse' : tag === 'rect' ? 'rectangle' : 'freeform';
      const points = kind === 'freeform' ? outline(element) : [];
      const d = element.getAttribute('d') || '';
      const fullRing = kind === 'freeform' && (d.match(/M/g) || []).length > 1;
      // A single full-circle slice is an exact native ellipse.
      if (kind === 'freeform' && !fullRing && !/L/.test(d)) kind = 'ellipse';
      const appearance = style(element);
      shapes.push({ ...b, kind, points: kind === 'freeform' ? points : [], pathClosed: true,
        label: '', ...appearance, ...(fullRing ? { stroke: 'none' } : {}), layer: tag === 'circle' ? 'background' : 'foreground' });
      if (fullRing && appearance.stroke !== 'none') {
        // The two opposite loops cancel their bridge in the fill. Outline them separately
        // to avoid stroking that bridge through the annulus.
        const radii = [...d.matchAll(/A\s*([-+0-9.eE]+)/g)].map(match => Number(match[1]));
        const ratio = Math.min(...radii) / Math.max(...radii);
        for (const scale of [1, ratio]) shapes.push({
          x: b.x + b.w * (1 - scale) / 2, y: b.y + b.h * (1 - scale) / 2,
          w: b.w * scale, h: b.h * scale, kind: 'ellipse', label: '', ...appearance, fill: 'none'
        });
      }
    }
    for (const element of svg.querySelectorAll('text.slice,text.pieTitleText,.legend text')) {
      if (!visible(element)) continue;
      const b = box(element), label = element.textContent.trim().slice(0, 1000);
      if (!label || !(b.w > 0 && b.h > 0)) continue;
      const ink = [...element.querySelectorAll('tspan')].find(span => span.textContent.trim()) || element;
      const css = getComputedStyle(ink);
      texts.push({ x: b.x - 5, y: b.y - 3, w: b.w + 10, h: b.h + 6, label,
        ...window.markinkOfficeStyle.text(element) });
    }
    if (!shapes.length || shapes.length > 200 || texts.length > 400) throw new Error('パイチャートの要素数が範囲外です');
    const view = svg.viewBox.baseVal;
    return JSON.stringify({ minX: view.x, minY: view.y, width: view.width, height: view.height, shapes, lines: [], texts });
  };
})();
