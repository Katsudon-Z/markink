export interface AwarenessLike {
  readonly clientID: number;
  getStates(): Map<number, unknown>;
}

let awareness: AwarenessLike | null = null;

export function attachAwareness(next: AwarenessLike | null): void {
  awareness = next;
}

export function getAttachedAwareness(): AwarenessLike | null {
  return awareness;
}
