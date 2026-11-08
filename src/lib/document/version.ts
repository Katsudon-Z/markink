import { Plugin } from 'prosemirror-state';
import type { Node as PMNode } from 'prosemirror-model';
import { advanceDocumentRevision } from './revision';

const listeners = new Set<(doc?: PMNode) => void>();

export function bumpDocumentVersion(doc?: PMNode): void {
  advanceDocumentRevision();
  for (const listener of listeners) {
    try { listener(doc); } catch { /* listeners must not interrupt editing */ }
  }
}

export function subscribeDocumentVersion(listener: (doc?: PMNode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function documentVersionPlugin(): Plugin {
  return new Plugin({
    appendTransaction(transactions, _oldState, newState) {
      if (transactions.some((transaction) => transaction.docChanged)) {
        bumpDocumentVersion(newState.doc);
      }
      return undefined;
    }
  });
}
