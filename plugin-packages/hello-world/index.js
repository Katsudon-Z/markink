self.markinkPlugin = {
  async activate(api) {
    await api.registerCommand(
      {
        id: 'insert-hello-world',
        title: 'HelloWorld を書く',
        placement: 'menu',
        description: '現在の選択位置に HelloWorld を挿入します'
      },
      async () => {
        const document = await api.readDocument();
        if (!document.selection) {
          throw new Error('編集できる選択位置がありません');
        }
        await api.applyEdit({
          baseRevision: document.revision,
          from: document.selection.from,
          to: document.selection.to,
          markdown: 'HelloWorld'
        });
      }
    );
  }
};
