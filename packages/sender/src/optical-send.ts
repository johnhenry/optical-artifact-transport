import {
  encodeCanonical,
  computeDigest,
  type OatArtifact,
  type CompressionScheme
} from '@oat/protocol';
import {
  prepareSource,
  generatePackets,
  renderPacketToCanvas,
  type FountainSource,
  type OatPacket
} from '@oat/qr-fountain';
import { resolveSource, type OpticalSource } from './source-adapters.js';
import { buildUiProposal } from './ui-proposal-authoring.js';
import { buildSenderArtifact } from './artifact-builder.js';

export type SenderState =
  | 'idle'
  | 'preparing'
  | 'manifest-ready'
  | 'transmitting'
  | 'paused'
  | 'complete'
  | 'error';

export interface SigningKey {
  secretKey: Uint8Array;
  keyId?: string;
}

const TEMPLATE = `
<style>
  :host { display: inline-block; }
  .shell { display: flex; flex-direction: column; gap: 0.5rem; font: 14px system-ui, sans-serif; }
  canvas { display: block; background: #fff; image-rendering: pixelated; }
  .controls { display: flex; align-items: center; gap: 0.5rem; }
  .progress { flex: 1; height: 4px; background: #ddd; border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: currentColor; width: 0%; }
</style>
<div class="shell" part="shell">
  <canvas part="frame qr-canvas"></canvas>
  <div class="controls" part="controls" hidden>
    <button type="button" data-action="toggle">Pause</button>
    <div class="progress" part="progress"><div></div></div>
    <slot name="manifest"></slot>
  </div>
  <slot name="empty"></slot>
</div>
`;

/**
 * `<optical-send>` — builds a signed/verified `OatArtifact` from `source`
 * and renders it as an endless, independently-decodable sequence of
 * fountain-coded QR frames. See README.md and docs/design.md for the full
 * protocol this implements.
 */
export class OpticalSendElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['src', 'controls'];
  }

  readonly #root: ShadowRoot;
  readonly #canvas: HTMLCanvasElement;
  readonly #toggleButton: HTMLButtonElement;
  readonly #progressFill: HTMLDivElement;
  readonly #controlsEl: HTMLElement;

  #state: SenderState = 'idle';
  #source: OpticalSource | null = null;
  #signingKey: SigningKey | null = null;
  #metadata: Record<string, unknown> | undefined;

  #artifact: OatArtifact | null = null;
  #fountainSource: FountainSource | null = null;
  #packetGenerator: Generator<OatPacket, never, void> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #framesSent = 0;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = TEMPLATE;
    this.#canvas = this.#root.querySelector('canvas') as HTMLCanvasElement;
    this.#toggleButton = this.#root.querySelector('button[data-action="toggle"]') as HTMLButtonElement;
    this.#progressFill = this.#root.querySelector('.progress > div') as HTMLDivElement;
    this.#controlsEl = this.#root.querySelector('.controls') as HTMLElement;
    this.#toggleButton.addEventListener('click', () => this.toggle());
  }

  connectedCallback(): void {
    this.#controlsEl.hidden = !this.hasAttribute('controls');
    const src = this.getAttribute('src');
    if (src && !this.#source) this.source = src;
  }

  disconnectedCallback(): void {
    this.stop();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === 'controls') this.#controlsEl.hidden = newValue === null;
    if (name === 'src' && newValue !== null && newValue !== oldValue) this.source = newValue;
  }

  get state(): SenderState {
    return this.#state;
  }

  get artifact(): OatArtifact | null {
    return this.#artifact;
  }

  get framesSent(): number {
    return this.#framesSent;
  }

  /** Payload to transmit: a Blob, Uint8Array, ArrayBuffer, URL/text string, ReadableStream, or async iterable. */
  set source(value: OpticalSource) {
    this.#source = value;
    void this.prepare();
  }

  get source(): OpticalSource | null {
    return this.#source;
  }

  set signingKey(key: SigningKey | null) {
    this.#signingKey = key;
  }

  get signingKey(): SigningKey | null {
    return this.#signingKey;
  }

  set metadata(value: Record<string, unknown> | undefined) {
    this.#metadata = value;
  }

  get frameRate(): number {
    const attr = Number(this.getAttribute('frame-rate'));
    return Number.isFinite(attr) && attr > 0 ? attr : 12;
  }

  get blockSize(): number {
    const attr = Number(this.getAttribute('block-size'));
    return Number.isFinite(attr) && attr > 0 ? attr : 200;
  }

  #setState(state: SenderState, detail?: Record<string, unknown>): void {
    this.#state = state;
    this.dispatchEvent(new CustomEvent('oat-state-change', { detail: { state, ...detail } }));
  }

  /** Builds the artifact and fountain source. Does not start transmitting — call `start()` for that. */
  async prepare(): Promise<void> {
    if (!this.#source) return;
    this.#setState('preparing');
    try {
      const hintMediaType = this.getAttribute('type') ?? undefined;
      const resolved = await resolveSource(this.#source, hintMediaType);

      const uiProposal = buildUiProposal({
        host: this,
        originId: this.getAttribute('origin-id') ?? (typeof location !== 'undefined' ? location.origin : 'optical-send'),
        title: this.getAttribute('title') ?? 'Optical transfer',
        summary: this.getAttribute('summary') ?? undefined,
        requestedProfile: (this.getAttribute('ui-mode') as never) ?? undefined,
        sanitizationProfile: (this.getAttribute('ui-sanitize') as never) ?? undefined
      });

      const compression = (this.getAttribute('compression') as CompressionScheme | null) ?? 'none';
      const requireSignature = this.getAttribute('verify') === 'signature';
      if (requireSignature && !this.#signingKey) {
        throw new Error('optical-send: verify="signature" requires a signingKey to be set before prepare()');
      }

      this.#artifact = await buildSenderArtifact({
        mediaType: resolved.mediaType ?? 'application/octet-stream',
        payload: resolved.bytes,
        compression,
        sign: this.#signingKey ?? undefined,
        uiProposal,
        metadata: this.#metadata
      });

      const envelopeBytes = encodeCanonical(this.#artifact) as Uint8Array;
      const artifactId = computeDigest(new TextEncoder().encode(this.#artifact.id)).value.slice(0, 16);

      this.#fountainSource = prepareSource(envelopeBytes, this.blockSize, artifactId);
      this.#packetGenerator = generatePackets(this.#fountainSource);
      this.#framesSent = 0;

      this.#setState('manifest-ready', {
        artifactId: this.#artifact.id,
        blockCount: this.#fountainSource.sourceBlockCount,
        byteLength: envelopeBytes.length
      });
      this.dispatchEvent(new CustomEvent('oat-manifest-ready', { detail: { artifact: this.#artifact } }));

      if (this.hasAttribute('autostart')) this.start();
    } catch (err) {
      this.#setState('error', { error: (err as Error).message });
      this.dispatchEvent(new CustomEvent('oat-error', { detail: { error: err } }));
    }
  }

  /** Starts (or resumes) rendering animated QR frames to the canvas. */
  start(): void {
    if (!this.#packetGenerator || !this.#fountainSource || this.#state === 'transmitting') return;
    this.#setState('transmitting');
    this.#toggleButton.textContent = 'Pause';
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), 1000 / this.frameRate);
  }

  pause(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    if (this.#state === 'transmitting') {
      this.#setState('paused');
      this.#toggleButton.textContent = 'Resume';
    }
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  toggle(): void {
    if (this.#state === 'transmitting') this.pause();
    else this.start();
  }

  #tick(): void {
    if (!this.#packetGenerator || !this.#fountainSource) return;
    const packet = this.#packetGenerator.next().value;
    renderPacketToCanvas(this.#canvas, packet, {
      errorCorrectionLevel: (this.getAttribute('ecc') as 'L' | 'M' | 'Q' | 'H' | null) ?? 'M'
    }).catch((err: unknown) => {
      this.dispatchEvent(new CustomEvent('oat-error', { detail: { error: err, phase: 'render' } }));
    });

    this.#framesSent++;
    const framesPerSweep = Math.max(1, Math.ceil(this.#fountainSource.sourceBlockCount * 1.3));
    const sweepProgress = (this.#framesSent % framesPerSweep) / framesPerSweep;
    this.#progressFill.style.width = `${Math.round(sweepProgress * 100)}%`;

    this.dispatchEvent(new CustomEvent('oat-progress', { detail: { framesSent: this.#framesSent } }));

    const loopLimit = Number(this.getAttribute('loop-limit')) || 0;
    if (loopLimit > 0 && this.#framesSent >= loopLimit * framesPerSweep) {
      this.stop();
      this.#setState('complete');
      this.dispatchEvent(new CustomEvent('oat-complete', { detail: { framesSent: this.#framesSent } }));
    }
  }
}

export function defineOpticalSend(tagName = 'optical-send'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, OpticalSendElement);
  }
}
