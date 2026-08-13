/**
 * The typed, validated postMessage protocol between a sandboxed remote-HTML
 * iframe and the receiver's policy engine. Every message is a request from
 * the sandbox for something it cannot do on its own (resize, ask for a
 * capability, submit a form, run an action) — the sandbox never gets a DOM
 * handle, a callback, or ambient authority; everything is mediated through
 * one of these typed, correlated exchanges.
 */

export interface ReadyMessage {
  type: 'ui.ready';
}
export interface ResizeMessage {
  type: 'ui.resize';
  height: number;
}
export interface CapabilityRequestMessage {
  type: 'request.capability';
  requestId: string;
  capability: string;
  reason?: string;
}
export interface ActionRequestMessage {
  type: 'request.action';
  requestId: string;
  action: string;
  payload?: unknown;
}
export interface SubmitFormMessage {
  type: 'submit.form';
  requestId: string;
  payload: Record<string, unknown>;
}

export type RemoteUiRequest =
  | ReadyMessage
  | ResizeMessage
  | CapabilityRequestMessage
  | ActionRequestMessage
  | SubmitFormMessage;

export interface PolicyResponse {
  type: 'policy';
  grantedCapabilities: string[];
}
export interface CapabilityResultResponse {
  type: 'capability.result';
  requestId: string;
  capability: string;
  allowed: boolean;
}
export interface ActionResultResponse {
  type: 'action.result';
  requestId: string;
  status: 'allowed' | 'denied';
}
export interface ErrorResponse {
  type: 'error';
  code: string;
  message: string;
  requestId?: string;
}

export type ReceiverUiResponse = PolicyResponse | CapabilityResultResponse | ActionResultResponse | ErrorResponse;

const KNOWN_REQUEST_TYPES = new Set<RemoteUiRequest['type']>([
  'ui.ready',
  'ui.resize',
  'request.capability',
  'request.action',
  'submit.form'
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Validates and narrows an arbitrary `postMessage` payload. Returns `null` for anything malformed or unrecognized. */
export function parseRemoteUiRequest(raw: unknown): RemoteUiRequest | null {
  if (!isPlainObject(raw) || typeof raw.type !== 'string' || !KNOWN_REQUEST_TYPES.has(raw.type as RemoteUiRequest['type'])) {
    return null;
  }

  switch (raw.type as RemoteUiRequest['type']) {
    case 'ui.ready':
      return { type: 'ui.ready' };

    case 'ui.resize':
      return typeof raw.height === 'number' && Number.isFinite(raw.height) ? { type: 'ui.resize', height: raw.height } : null;

    case 'request.capability':
      return typeof raw.requestId === 'string' && typeof raw.capability === 'string'
        ? {
            type: 'request.capability',
            requestId: raw.requestId,
            capability: raw.capability,
            reason: typeof raw.reason === 'string' ? raw.reason : undefined
          }
        : null;

    case 'request.action':
      return typeof raw.requestId === 'string' && typeof raw.action === 'string'
        ? { type: 'request.action', requestId: raw.requestId, action: raw.action, payload: raw.payload }
        : null;

    case 'submit.form':
      return typeof raw.requestId === 'string' && isPlainObject(raw.payload)
        ? { type: 'submit.form', requestId: raw.requestId, payload: raw.payload }
        : null;

    default:
      return null;
  }
}

export interface IframeBridgeOptions {
  onRequest: (request: RemoteUiRequest) => void;
  /** Messages beyond this rate (per rolling 1s window) are silently dropped. */
  rateLimitPerSecond?: number;
  onRateLimited?: (droppedCount: number) => void;
}

export interface IframeBridge {
  postResponse(response: ReceiverUiResponse): void;
  destroy(): void;
}

/**
 * Wires a `window` `message` listener scoped to exactly one iframe (by
 * object identity, via `event.source`) — not by origin string, since a
 * `sandbox="allow-scripts"` iframe *without* `allow-same-origin` has an
 * opaque ("null") origin that can't be usefully compared. Checking
 * `event.source === iframe.contentWindow` is the correct mitigation here:
 * it can't be spoofed by another page, because only this exact iframe's
 * realm can ever be that object.
 *
 * `postResponse` correspondingly must target `'*'` — pinning a textual
 * origin for an opaque-origin iframe isn't possible — but this is safe
 * because the message goes directly to a held `contentWindow` reference,
 * never broadcast.
 */
export function createIframeBridge(iframe: HTMLIFrameElement, options: IframeBridgeOptions): IframeBridge {
  const rateLimitPerSecond = options.rateLimitPerSecond ?? 20;
  let windowStart = Date.now();
  let countInWindow = 0;
  let droppedInWindow = 0;
  let destroyed = false;

  const onMessage = (event: MessageEvent) => {
    if (destroyed) return;
    if (event.source !== iframe.contentWindow) return;

    const now = Date.now();
    if (now - windowStart > 1000) {
      if (droppedInWindow > 0) options.onRateLimited?.(droppedInWindow);
      windowStart = now;
      countInWindow = 0;
      droppedInWindow = 0;
    }
    countInWindow++;
    if (countInWindow > rateLimitPerSecond) {
      droppedInWindow++;
      return;
    }

    const request = parseRemoteUiRequest(event.data);
    if (!request) return;
    options.onRequest(request);
  };

  window.addEventListener('message', onMessage);

  return {
    postResponse(response) {
      if (destroyed) return;
      iframe.contentWindow?.postMessage(response, '*');
    },
    destroy() {
      destroyed = true;
      window.removeEventListener('message', onMessage);
    }
  };
}
