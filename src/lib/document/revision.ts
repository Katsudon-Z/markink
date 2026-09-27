/** Monotonic in-memory revision shared by document consumers. */
let revision = 0;

export function getDocumentRevision(): number {
  return revision;
}

export function advanceDocumentRevision(): number {
  revision += 1;
  return revision;
}

export function resetDocumentRevision(): void {
  revision = 0;
}

