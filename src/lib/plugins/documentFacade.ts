import type { EditorView } from 'prosemirror-view';
import { markdownParser, markdownSerializer } from '../prosemirror/markdown';
import { getDocumentRevision } from '../document/revision';
import type { DocumentSnapshot, EditProposal, EditResult } from './api';

const MAX_EDIT_BYTES = 512 * 1024;
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024;

export interface DocumentFacadeOptions {
  getView: () => EditorView | null;
  getTitle: () => string;
  getRevision?: () => number;
  confirmEdit: (proposal: EditProposal, documentSize: number) => Promise<boolean>;
}

/** Stable document API adapter; editor and collaboration objects stay inside the host. */
export class DocumentFacade {
  constructor(private readonly options: DocumentFacadeOptions) {}

  read(): DocumentSnapshot {
    const view = this.requireView();
    const markdown = markdownSerializer.serialize(view.state.doc);
    if (new TextEncoder().encode(markdown).byteLength > MAX_SNAPSHOT_BYTES) {
      throw new Error('文書が大きすぎるため、拡張APIでは全文を返せません。');
    }
    return {
      title: this.options.getTitle(),
      markdown,
      selection: {
        from: view.state.selection.from,
        to: view.state.selection.to
      },
      revision: this.revision()
    };
  }

  async applyEdit(proposal: EditProposal): Promise<EditResult> {
    if (new TextEncoder().encode(proposal.markdown).byteLength > MAX_EDIT_BYTES) {
      throw new Error('編集提案が大きすぎます (上限 512 KiB)。');
    }
    const view = this.requireView();
    const { doc } = view.state;
    if (proposal.baseRevision !== this.revision()) {
      throw new Error('文書が更新されています。最新の内容を読み直してから編集してください。');
    }
    if (
      !Number.isInteger(proposal.from) ||
      !Number.isInteger(proposal.to) ||
      proposal.from < 0 ||
      proposal.to < proposal.from ||
      proposal.to > doc.content.size
    ) {
      throw new Error('編集範囲が現在の文書範囲外です。');
    }

    const isWholeDocument = proposal.from === 0 && proposal.to === doc.content.size;
    if (isWholeDocument) {
      const approved = await this.options.confirmEdit(proposal, doc.content.size);
      if (!approved) throw new Error('編集はキャンセルされました。');
    }

    // Confirmation may take time; refuse to apply coordinates against a changed document.
    if (proposal.baseRevision !== this.revision()) {
      throw new Error('確認中に文書が更新されました。最新の内容を読み直してください。');
    }

    const fragment = markdownParser.parse(proposal.markdown).content;
    const transaction = view.state.tr.replaceWith(proposal.from, proposal.to, fragment);
    view.dispatch(transaction);
    const from = proposal.from;
    const to = from + fragment.size;
    return { from, to, revision: this.revision() };
  }

  private revision(): number {
    return (this.options.getRevision ?? getDocumentRevision)();
  }

  private requireView(): EditorView {
    const view = this.options.getView();
    if (!view || view.isDestroyed) throw new Error('編集できる文書が開かれていません。');
    return view;
  }
}
