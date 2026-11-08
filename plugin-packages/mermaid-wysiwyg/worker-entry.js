
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
