import {
  createCapabilityPolicy,
  buildUiDecisionArtifact,
  type CapabilityPolicy,
  type OatArtifact,
  type BuildArtifactOptions,
  type UiDecision,
  type UiDecisionStatus
} from '@oat/protocol';
import type { ImageDataLike } from '@oat/qr-fountain';
import { createCameraController, type CameraController, type FacingMode } from './camera-controller.js';
import { createInlineDecodeWorker, type DecodeWorker } from './decode-worker.js';
import { PacketStore } from './packet-store.js';
import { assembleArtifact } from './assembler.js';
import { verifyReceivedArtifact, type ReceiverVerificationResult } from './verifier.js';
import { PolicyEngine, profileOf, type PolicyDecision, type SignableProfile, type UiApprovalMode } from './policy-engine.js';

export type ReceiverState =
  | 'idle'
  | 'permission-requested'
  | 'camera-ready'
  | 'receiving'
  | 'verifying'
  | 'accepted'
  | 'ui-proposed'
  | 'unsafe-proposed'
  | 'awaiting-consent'
  | 'downgraded'
  | 'rejected'
  | 'error';

const DISPLAY_BUCKET: Record<ReceiverState, 'empty' | 'scanning' | 'verifying' | 'complete' | 'rejected' | 'error'> = {
  idle: 'empty',
  'permission-requested': 'empty',
  'camera-ready': 'empty',
  receiving: 'scanning',
  verifying: 'verifying',
  accepted: 'complete',
  'ui-proposed': 'complete',
  'unsafe-proposed': 'complete',
  'awaiting-consent': 'complete',
  downgraded: 'complete',
  rejected: 'rejected',
  error: 'error'
};

const TEMPLATE = `
<style>
  :host { display: inline-block; }
  .shell { display: flex; flex-direction: column; gap: 0.5rem; font: 14px system-ui, sans-serif; }
  video { display: block; background: #111; max-width: 100%; }
  .controls { display: flex; align-items: center; gap: 0.5rem; }
  .progress { flex: 1; height: 4px; background: #ddd; border-radius: 2px; overflow: hidden; }
  .progress > div { height: 100%; background: currentColor; width: 0%; }
  .state-slot[hidden] { display: none; }
</style>
<div class="shell" part="shell">
  <video part="camera-preview" playsinline muted></video>
  <div class="controls" part="controls" hidden>
    <div class="progress" part="progress"><div></div></div>
  </div>
  <div class="state-slot" data-for="empty"><slot name="empty">Point a camera at an &lt;optical-send&gt; screen.</slot></div>
  <div class="state-slot" data-for="scanning"><slot name="scanning">Scanning…</slot></div>
  <div class="state-slot" data-for="verifying"><slot name="verifying">Verifying…</slot></div>
  <div class="state-slot" data-for="complete"><slot name="complete">Received.</slot></div>
  <div class="state-slot" data-for="rejected" part="trust-warning"><slot name="rejected">Rejected.</slot></div>
  <div class="state-slot" data-for="error" part="trust-warning"><slot name="error">Something went wrong.</slot></div>
</div>
`;

/**
 * `<optical-receive>` — captures camera frames, fountain-decodes them into
 * an artifact, verifies its digest/signature/expiry, and (if the sender
 * proposed one) computes a UI decision via `PolicyEngine`. This element
 * never renders sender HTML itself — see `@oat/ui` for the safe-view /
 * safe-html renderers that consume `oat-ui-proposal` events.
 *
 * `processFrame()` is public specifically so the whole capture->verify->
 * decide pipeline can be tested with synthetically rendered QR frames,
 * without a real camera — see test/optical-receive.test.ts.
 */
export class OpticalReceiveElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['controls'];
  }

  readonly #root: ShadowRoot;
  readonly #video: HTMLVideoElement;
  readonly #scanCanvas: HTMLCanvasElement;
  readonly #controlsEl: HTMLElement;
  readonly #progressFill: HTMLDivElement;
  readonly #slotEls: Record<string, HTMLElement>;

  readonly #camera: CameraController;
  readonly #decodeWorker: DecodeWorker;
  readonly #packetStore = new PacketStore();
  #policyEngine: PolicyEngine;
  #capabilityPolicy: CapabilityPolicy = createCapabilityPolicy([]);
  #allowUnsafeHtml = false;
  #trustedPublicKeysHex: string[] = [];
  #requireSignatureFor: SignableProfile[] = [];
  #approval: Partial<Record<SignableProfile, UiApprovalMode>> = {};

  #state: ReceiverState = 'idle';
  #timer: ReturnType<typeof setInterval> | null = null;
  #artifact: OatArtifact | null = null;
  #verification: ReceiverVerificationResult | null = null;
  #uiDecision: PolicyDecision | null = null;
  #userApprovedCapabilities: string[] = [];

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
    this.#root.innerHTML = TEMPLATE;
    this.#video = this.#root.querySelector('video') as HTMLVideoElement;
    this.#scanCanvas = document.createElement('canvas');
    this.#controlsEl = this.#root.querySelector('.controls') as HTMLElement;
    this.#progressFill = this.#root.querySelector('.progress > div') as HTMLDivElement;
    this.#slotEls = {};
    this.#root.querySelectorAll<HTMLElement>('.state-slot').forEach((el) => {
      const key = el.dataset.for as string;
      this.#slotEls[key] = el;
    });

    this.#camera = createCameraController();
    this.#decodeWorker = createInlineDecodeWorker();
    this.#policyEngine = new PolicyEngine({ capabilityPolicy: this.#capabilityPolicy, allowUnsafeHtml: this.#allowUnsafeHtml });
    this.#updateSlotVisibility();
  }

  connectedCallback(): void {
    this.#controlsEl.hidden = !this.hasAttribute('controls');
  }

  disconnectedCallback(): void {
    this.stop();
  }

  attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null): void {
    if (name === 'controls') this.#controlsEl.hidden = newValue === null;
  }

  get state(): ReceiverState {
    return this.#state;
  }

  get artifact(): OatArtifact | null {
    return this.#artifact;
  }

  get verification(): ReceiverVerificationResult | null {
    return this.#verification;
  }

  get uiDecision(): PolicyDecision | null {
    return this.#uiDecision;
  }

  get progress(): number {
    return this.#packetStore.progress;
  }

  /** Total frames processed (decoded or not) in the current session. */
  get framesSeen(): number {
    return this.#packetStore.framesSeen;
  }

  /** Overrides the default (fully permissive-deny) capability policy. */
  set capabilityPolicy(policy: CapabilityPolicy) {
    this.#capabilityPolicy = policy;
    this.#rebuildPolicyEngine();
  }

  /**
   * M6 break-glass opt-in. Defaults `false`: even a fully-eligible
   * `sandboxed-html` proposal (valid signature, etc.) is downgraded unless
   * this is explicitly set `true`.
   */
  set allowUnsafeHtml(value: boolean) {
    this.#allowUnsafeHtml = value;
    this.#rebuildPolicyEngine();
  }

  /**
   * Hex-encoded Ed25519 public keys this receiver trusts as senders. A
   * *signature* only proves content wasn't tampered with in transit —
   * anyone can generate their own keypair — so this list is what actually
   * answers "identity verified" for anything security-sensitive,
   * particularly the M6 unsafe-HTML tier (`allowUnsafeHtml` alone is inert
   * for a sender not on this list; see `checkSandboxEligibility`).
   */
  set trustedPublicKeys(keysHex: readonly string[]) {
    this.#trustedPublicKeysHex = [...keysHex];
    this.#rebuildPolicyEngine();
  }

  /**
   * Per-profile signature requirement, independent of the `verify`/
   * `require-signature` attribute (which is a blanket, artifact-wide
   * requirement). `sandboxed-html` always requires a signature regardless
   * of whether it's listed here — see `checkSandboxEligibility`.
   */
  set requireSignatureFor(profiles: readonly SignableProfile[]) {
    this.#requireSignatureFor = [...profiles];
    this.#rebuildPolicyEngine();
  }

  /**
   * Per-profile consent UX: `'automatic'` (default), `'prompt'`, or
   * `'prompt-with-warning'`. A non-`'automatic'` mode puts the receiver in
   * the `awaiting-consent` state and withholds `oat-ui-proposal` until
   * `confirmProposal()`/`dismissProposal()` is called — see those methods.
   */
  set approvalPolicy(policy: Partial<Record<SignableProfile, UiApprovalMode>>) {
    this.#approval = { ...policy };
    this.#rebuildPolicyEngine();
  }

  #rebuildPolicyEngine(): void {
    this.#policyEngine = new PolicyEngine({
      capabilityPolicy: this.#capabilityPolicy,
      uiPolicy: (this.getAttribute('ui-policy') as 'safe' | 'none' | null) ?? undefined,
      // A signature alone proves content wasn't tampered with, not who sent
      // it — anyone can generate a keypair. So allowUnsafeHtml is inert
      // without a non-empty trust list: flipping the opt-in alone must
      // never be enough to run arbitrary sender script.
      allowUnsafeHtml: this.#allowUnsafeHtml && this.#trustedPublicKeysHex.length > 0,
      requireSignatureFor: this.#requireSignatureFor,
      approval: this.#approval
    });
  }

  /** Grants capabilities the user has explicitly approved; re-evaluates any pending UI decision. */
  approveCapabilities(capabilities: readonly string[]): PolicyDecision | null {
    this.#userApprovedCapabilities = [...new Set([...this.#userApprovedCapabilities, ...capabilities])];
    if (this.#artifact?.uiProposal && this.#verification) {
      this.#uiDecision = this.#policyEngine.decideUi(
        this.#artifact.uiProposal,
        this.#verification,
        this.#userApprovedCapabilities
      );
    }
    return this.#uiDecision;
  }

  /** Checks one capability against this receiver's policy — used by the M6 sandbox bridge to mediate each request individually. */
  checkCapability(capability: string): boolean {
    return this.#policyEngine.checkCapability(capability, this.#userApprovedCapabilities);
  }

  /**
   * Proceeds past an `awaiting-consent` gate (an `accept-safe` decision
   * whose `approvalMode` is `'prompt'`/`'prompt-with-warning'`), emitting
   * the withheld `oat-ui-proposal` event.
   */
  confirmProposal(): void {
    if (this.#state !== 'awaiting-consent' || !this.#artifact?.uiProposal || !this.#uiDecision) return;
    this.#setState('ui-proposed');
    this.dispatchEvent(
      new CustomEvent('oat-ui-proposal', {
        detail: { proposal: this.#artifact.uiProposal, decision: this.#uiDecision, artifact: this.#artifact }
      })
    );
  }

  /** Declines a pending `awaiting-consent` proposal without rendering it. */
  dismissProposal(reason = 'user-dismissed'): void {
    if (this.#state !== 'awaiting-consent') return;
    this.#setState('rejected', { reason });
    this.dispatchEvent(new CustomEvent('oat-rejected', { detail: { reasons: [reason] } }));
  }

  /**
   * Builds the wire-level `ui.decision` acknowledgment for the most recent
   * UI proposal — see `@oat/protocol`'s `ui-decision.ts` for the type and
   * the design doc's acceptance algorithm step 7. This only builds the
   * artifact; how it physically travels back to the sender (a second
   * `<optical-send>`, a bootstrap data channel, ...) is up to the host.
   */
  async buildDecisionArtifact(sign?: BuildArtifactOptions['sign']): Promise<OatArtifact> {
    if (!this.#artifact?.uiProposal || !this.#uiDecision) {
      throw new Error('optical-receive: no pending UI decision to build an artifact for');
    }
    return buildUiDecisionArtifact(this.#toWireDecision(this.#artifact.uiProposal, this.#uiDecision), sign);
  }

  #toWireDecision(
    proposal: NonNullable<OatArtifact['uiProposal']>,
    decision: PolicyDecision
  ): UiDecision {
    const STATUS_BY_OUTCOME: Record<PolicyDecision['outcome'], UiDecisionStatus> = {
      reject: 'rejected',
      downgrade: 'downgraded',
      'accept-safe': 'accepted',
      'accept-unsafe': 'accepted'
    };
    const status = STATUS_BY_OUTCOME[decision.outcome];
    const granted = decision.effectiveCapabilities;
    const denied = proposal.requestedCapabilities
      .filter((c) => !granted.includes(c.capability))
      .map((c) => ({ capability: c.capability, reason: decision.reasons[0] ?? 'not granted by receiver policy' }));

    return {
      type: 'ui.decision',
      version: 1,
      proposalId: proposal.proposalId,
      status,
      profile: status === 'accepted' ? profileOf(proposal.requestedProfile) : undefined,
      grantedCapabilities: granted,
      deniedCapabilities: denied,
      sanitized: status === 'accepted' && decision.outcome !== 'accept-unsafe',
      fallbackUsed: decision.outcome === 'downgrade',
      capabilityToken: granted.length > 0 ? crypto.randomUUID() : undefined,
      decidedAt: new Date().toISOString()
    };
  }

  #setState(state: ReceiverState, detail?: Record<string, unknown>): void {
    this.#state = state;
    this.#updateSlotVisibility();
    this.dispatchEvent(new CustomEvent('oat-state-change', { detail: { state, ...detail } }));
  }

  #updateSlotVisibility(): void {
    const active = DISPLAY_BUCKET[this.#state];
    for (const [key, el] of Object.entries(this.#slotEls)) {
      el.hidden = key !== active;
    }
  }

  /** Requests camera access and begins scanning. */
  async start(): Promise<void> {
    if (this.#state !== 'idle' && this.#state !== 'rejected' && this.#state !== 'error') return;
    this.#setState('permission-requested');
    try {
      const facingMode = (this.getAttribute('camera') as FacingMode | null) ?? 'environment';
      const stream = await this.#camera.start(facingMode);
      this.#video.srcObject = stream;
      await this.#video.play();
      this.#setState('camera-ready');
      this.#startFrameLoop();
    } catch (err) {
      this.#setState('error', { error: (err as Error).message });
      this.dispatchEvent(new CustomEvent('oat-error', { detail: { error: err } }));
    }
  }

  stop(): void {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#camera.stop();
    this.#video.srcObject = null;
  }

  /** Resets to a fresh receiving session, discarding any in-progress or completed transfer. */
  reset(): void {
    this.#packetStore.reset();
    this.#artifact = null;
    this.#verification = null;
    this.#uiDecision = null;
    this.#userApprovedCapabilities = [];
    this.#progressFill.style.width = '0%';
    this.#setState(this.#camera.stream ? 'camera-ready' : 'idle');
  }

  #startFrameLoop(): void {
    const scanRate = Number(this.getAttribute('scan-rate')) || 8;
    this.#timer = setInterval(() => this.#scanFrame(), 1000 / scanRate);
  }

  #scanFrame(): void {
    if (!this.#video.videoWidth || !this.#video.videoHeight) return;
    this.#scanCanvas.width = this.#video.videoWidth;
    this.#scanCanvas.height = this.#video.videoHeight;
    const ctx = this.#scanCanvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(this.#video, 0, 0);
    const image = ctx.getImageData(0, 0, this.#scanCanvas.width, this.#scanCanvas.height);
    this.processFrame(image);
  }

  /**
   * Processes one already-captured frame through decode -> fountain store ->
   * (on completion) assemble/verify/policy-decide. Exposed publicly so the
   * pipeline is testable with synthetic frames, and reusable if a host
   * wants to feed frames from something other than this element's own
   * camera loop (e.g. a file, or a different capture surface).
   */
  processFrame(image: ImageDataLike): void {
    if (this.#packetStore.isComplete) return;

    const packet = this.#decodeWorker.decodeFrame(image);
    const completed = this.#packetStore.ingestFrame(packet);

    this.dispatchEvent(
      new CustomEvent('oat-frame', {
        detail: { decoded: Boolean(packet), progress: this.#packetStore.progress, framesSeen: this.#packetStore.framesSeen }
      })
    );
    this.#progressFill.style.width = `${Math.round(this.#packetStore.progress * 100)}%`;

    if ((this.#state === 'camera-ready' || this.#state === 'idle') && packet) this.#setState('receiving');

    if (completed) void this.#handleComplete();
  }

  async #handleComplete(): Promise<void> {
    this.#setState('verifying');

    let bytes: Uint8Array;
    try {
      bytes = this.#packetStore.reconstruct();
    } catch (err) {
      this.#setState('error', { error: (err as Error).message });
      this.dispatchEvent(new CustomEvent('oat-error', { detail: { error: err } }));
      return;
    }

    const artifact = assembleArtifact(bytes);
    if (!artifact) {
      this.#setState('rejected', { reason: 'malformed-artifact' });
      this.dispatchEvent(new CustomEvent('oat-rejected', { detail: { reasons: ['malformed-artifact'] } }));
      return;
    }
    this.#artifact = artifact;

    const acceptAttr = this.getAttribute('accept');
    const acceptMediaTypes = acceptAttr ? acceptAttr.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
    const requireSignature = this.getAttribute('verify') === 'signature' || this.hasAttribute('require-signature');

    const verification = verifyReceivedArtifact(artifact, {
      requireSignature,
      acceptMediaTypes,
      trustedPublicKeysHex: this.#trustedPublicKeysHex
    });
    this.#verification = verification;

    if (!verification.valid) {
      this.#setState('rejected', { reasons: verification.reasons });
      this.dispatchEvent(new CustomEvent('oat-rejected', { detail: { verification } }));
      return;
    }

    if (artifact.uiProposal) {
      const decision = this.#policyEngine.decideUi(artifact.uiProposal, verification, this.#userApprovedCapabilities);
      this.#uiDecision = decision;

      if (decision.outcome === 'downgrade') {
        this.#setState('downgraded');
        this.dispatchEvent(
          new CustomEvent('oat-ui-proposal', { detail: { proposal: artifact.uiProposal, decision, artifact } })
        );
      } else if (decision.outcome === 'accept-unsafe') {
        this.#setState('unsafe-proposed');
        this.dispatchEvent(
          new CustomEvent('oat-ui-proposal', { detail: { proposal: artifact.uiProposal, decision, artifact } })
        );
      } else if (decision.requiresExplicitApproval) {
        // accept-safe, but this profile's approvalMode requires an explicit host/user gesture
        // before oat-ui-proposal fires — see confirmProposal()/dismissProposal().
        this.#setState('awaiting-consent');
        this.dispatchEvent(
          new CustomEvent('oat-consent-required', { detail: { proposal: artifact.uiProposal, decision, artifact } })
        );
      } else {
        this.#setState('ui-proposed');
        this.dispatchEvent(
          new CustomEvent('oat-ui-proposal', { detail: { proposal: artifact.uiProposal, decision, artifact } })
        );
      }
    } else {
      this.#setState('accepted');
    }

    this.dispatchEvent(new CustomEvent('oat-artifact', { detail: { artifact, verification } }));
  }
}

export function defineOpticalReceive(tagName = 'optical-receive'): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, OpticalReceiveElement);
  }
}
