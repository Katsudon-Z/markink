(() => {
  // State identities come from Mermaid; geometry and styles remain sourced from the SVG.
  window.markinkStateOfficeDrawing = async function(source, svg) {
    const parsed = await window.markinkMermaid.mermaidAPI.getDiagramFromText(source);
    if (parsed.type === 'state') throw new Error('state.defaultRendererをdagre-wrapperに設定して描画してください');
    parsed.db.extract(parsed.db.getRootDocV2());
    const data = parsed.db.getData();
    const type = { rect: 'stateRect', rectWithTitle: 'square', choice: 'diamond', fork: 'square', join: 'square', note: 'square', divider: 'square' };
    const vertexIds = data.nodes.map(node => ({
      id: node.id, domId: node.domId, shape: node.shape,
      type: type[node.shape] || node.shape, text: node.label
    }));
    return window.markinkGraphOfficeDrawing(svg, {
      state: true, vertexIds, connections: new Map(data.edges.map(edge => [edge.id, edge]))
    });
  };
})();
