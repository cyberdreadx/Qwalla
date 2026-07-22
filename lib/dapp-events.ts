/**
 * Tiny event bus between wallet internals and the dApp browser bridge.
 *
 * The browser screen registers a sink that injects `rougechain-event`
 * messages into the WebView; wallet/network stores emit through it.
 * Kept dependency-free so any module can import it without cycles.
 */

export type DappEventName = 'accountsChanged' | 'networkChanged' | 'disconnect';

type Sink = (event: DappEventName, data: unknown) => void;

let sink: Sink | null = null;

/** Browser screen calls this with an injector; returns a cleanup fn. */
export function setDappEventSink(fn: Sink): () => void {
  sink = fn;
  return () => {
    if (sink === fn) sink = null;
  };
}

/** Fire an event toward the connected dApp (no-op when no browser is open). */
export function emitDappEvent(event: DappEventName, data: unknown): void {
  try {
    sink?.(event, data);
  } catch {
    /* never let a dApp bridge failure break wallet flows */
  }
}
