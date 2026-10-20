/** Share one in-flight fresh Attention generate per date range (spec 05 · F1 remounts). */
const inflight = new Map<string, Promise<unknown>>();

export function attentionRangeKey(from: string, to: string): string {
  return `${from <= to ? from : to}|${from <= to ? to : from}`;
}

/** Run `start` once per key; concurrent callers await the same promise. */
export function shareAttentionFresh<T>(key: string, start: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const pending = start().finally(() => {
    if (inflight.get(key) === pending) inflight.delete(key);
  });
  inflight.set(key, pending);
  return pending;
}

/** Test-only: drop every pending entry. */
export function clearAttentionInflightForTests(): void {
  inflight.clear();
}
