import type { ChannelMessage } from './types.js';

// Dual-channel strategy:
//   1. BroadcastChannel — zero-latency, works in all modern browsers on http://
//      and on file:// in Chrome/Edge/Firefox (same-origin null).
//   2. localStorage storage event — universal fallback; fires in other tabs
//      even when BroadcastChannel is unavailable on file://.
// Both are written on every send so the receiver only needs one listener.
// Receivers deduplicate by timestamp to avoid double-handling.

const LS_KEY  = 'caption_push2_event';
const BC_NAME = 'caption_push2';

const bc: BroadcastChannel | null = (() => {
  try { return new BroadcastChannel(BC_NAME); } catch { return null; }
})();

export function sendMessage(msg: Omit<ChannelMessage, 'timestamp'>): number {
  const ts = Date.now();
  const full: ChannelMessage = { ...msg, timestamp: ts } as ChannelMessage;
  const json = JSON.stringify(full);
  // BroadcastChannel (fast path)
  bc?.postMessage(full);
  // localStorage (fallback — also acts as persistence for late-joining windows)
  try { localStorage.setItem(LS_KEY, json); } catch { /* private-browsing quota */ }
  return ts;
}

export function onMessage(handler: (msg: ChannelMessage) => void): () => void {
  const seen = new Set<number>();

  function dispatch(msg: ChannelMessage) {
    // De-duplicate: localStorage and BroadcastChannel both fire for the same send
    if (seen.has(msg.timestamp)) return;
    seen.add(msg.timestamp);
    // Keep the set small
    if (seen.size > 100) seen.clear();
    handler(msg);
  }

  // BroadcastChannel listener
  if (bc) {
    bc.onmessage = (e: MessageEvent<ChannelMessage>) => dispatch(e.data);
  }

  // localStorage listener (fallback + cross-tab on file://)
  const storageListener = (e: StorageEvent) => {
    if (e.key === LS_KEY && e.newValue) {
      try { dispatch(JSON.parse(e.newValue) as ChannelMessage); } catch { /* ignore malformed */ }
    }
  };
  window.addEventListener('storage', storageListener);

  return () => {
    if (bc) bc.onmessage = null;
    window.removeEventListener('storage', storageListener);
  };
}
