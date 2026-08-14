import { defineOpticalSend, type OpticalSendElement } from '@johnhenry/oat-sender';
import { defineOpticalReceive, type OpticalReceiveElement } from '@johnhenry/oat-receiver';
import {
  buildArtifact,
  generateSigningKey,
  createCapabilityPolicy,
  computeDigest,
  extractPayload,
  verifyArtifact,
  extractUiDecision,
  type UiActionRequest,
  type UiProposalEnvelope
} from '@johnhenry/oat-protocol';
import { renderSafeHtml, renderSafeView, renderCapabilityPrompt, renderUnsafeOptInPrompt, mountSandboxedHtml, renderTrustPrompt } from '@johnhenry/oat-ui';
import QRCode from 'qrcode';
import {
  buildReleaseManifestArtifact,
  extractReleaseManifest,
  fetchAndVerifyManifest,
  RELEASE_MANIFEST_MEDIA_TYPE,
  createOfferArtifact,
  createAnswerArtifact,
  applyAnswerArtifact,
  WEBRTC_BOOTSTRAP_MEDIA_TYPE
} from '@johnhenry/oat-bootstrap';

defineOpticalSend();
defineOpticalReceive();

const $ = <T extends Element>(selector: string) => document.querySelector(selector) as T;

const sender = $<OpticalSendElement>('#sender');
const receiver = $<OpticalReceiveElement>('#receiver');
const senderLog = $<HTMLPreElement>('#sender-log');
const receiverLog = $<HTMLPreElement>('#receiver-log');
const resultEl = $<HTMLPreElement>('#result');
const proposalHost = $<HTMLDivElement>('#proposal-host');
const capabilityHost = $<HTMLDivElement>('#capability-host');
const trustHost = $<HTMLDivElement>('#trust-host');
const proposalTemplate = sender.querySelector('template[slot="proposal"]') as HTMLTemplateElement;
const payloadTypeSelect = $<HTMLSelectElement>('#payload-type');
const resultMedia = $<HTMLDivElement>('#result-media');

// The library imposes no size cap (see @johnhenry/oat-qr-fountain) — this demo's own
// guard exists because the effective throughput over 200-byte QR frames at
// 12fps, after the fountain code's ~30% redundancy overhead, is only about
// 700 KB/min: technically "works" well past this, but stops being a demo.
const MAX_FILE_BYTES = 300_000;
const WARN_FILE_BYTES = 20_000;
let lastResultObjectUrl: string | null = null;

function revokeLastResultObjectUrl(): void {
  if (lastResultObjectUrl) {
    URL.revokeObjectURL(lastResultObjectUrl);
    lastResultObjectUrl = null;
  }
}

function estimateTransferSeconds(bytes: number): number {
  const frames = Math.ceil(Math.ceil(bytes / 200) * 1.3);
  return Math.ceil(frames / 12);
}

/**
 * `sender.source = value` kicks off `prepare()` (which reads the light-DOM
 * proposal <template>) asynchronously and un-awaitably — removing the
 * template and synchronously re-appending it right after setting `source`
 * does NOT reliably exclude it, since `resolveSource()`'s first `await`
 * yields for only one microtask tick, same as the synchronous re-append.
 * Waiting for the resulting `oat-manifest-ready`/`oat-error` guarantees
 * `buildUiProposal()` has already run (or errored) before the template is
 * restored.
 */
function waitForPrepared(el: OpticalSendElement): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('oat-manifest-ready', done);
      el.removeEventListener('oat-error', done);
      resolve();
    };
    el.addEventListener('oat-manifest-ready', done, { once: true });
    el.addEventListener('oat-error', done, { once: true });
  });
}

// Deliberately adversarial content for the M6 break-glass demo: it tries to
// read the parent document (must throw — the sandbox has no allow-same-origin,
// so its origin is opaque) and requests a capability the receiver never
// granted (must be denied). Both attempts report their own outcome back
// through the typed bridge rather than the demo asserting anything for them.
const ADVERSARIAL_SANDBOX_HTML = `<!doctype html>
<div id="out" style="font: 13px monospace; white-space: pre-wrap;"></div>
<script>
  const out = document.getElementById('out');
  function log(msg) { out.textContent += msg + '\\n'; }

  window.parent.postMessage({ type: 'ui.ready' }, '*');

  try {
    void window.parent.document;
    log('SECURITY FAILURE: read window.parent.document');
  } catch (e) {
    log('OK: blocked from reading window.parent.document (' + e.constructor.name + ')');
  }

  window.parent.postMessage({ type: 'request.capability', requestId: 'cap-1', capability: 'html.storage', reason: 'adversarial test' }, '*');
  window.parent.postMessage({ type: 'request.action', requestId: 'act-1', action: 'approve' }, '*');

  window.addEventListener('message', (e) => log('received: ' + JSON.stringify(e.data)));
</script>`;

function log(target: HTMLPreElement, ...parts: unknown[]): void {
  const line = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ');
  target.textContent = `${new Date().toLocaleTimeString()}  ${line}\n${target.textContent}`;
}

// Receiver is deliberately configured to *not* auto-approve the capability
// the demo proposal requests — approval only happens via the capability
// prompt below, demonstrating "effective capabilities = requested ∩ policy
// ∩ user-approved" end to end rather than trusting the sender by default.
receiver.capabilityPolicy = createCapabilityPolicy([
  'agent.session.import',
  'ui.render.form.basic',
  'ui.action.submit',
  'calendar.event.create'
]);

// M6 break-glass is opted into for this demo so the flow can actually be
// exercised. It still only ever activates for a signed proposal FROM A
// TRUSTED SENDER, and even then only after the user clicks through the
// high-visibility opt-in prompt — see checkSandboxEligibility and the
// 'accept-unsafe' branch in the oat-ui-proposal handler below. A valid
// signature alone is not authorization — anyone can generate their own
// keypair — so allowUnsafeHtml is paired with an explicit trust list.
receiver.allowUnsafeHtml = true;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

const signingKey = generateSigningKey();
const ownPublicKeyHex = toHex(signingKey.publicKey);

// The receiver starts with an empty trust list and requires explicit trust
// for every signer — including this device's own key, in the same-tab
// loopback case. The public key travels inline with every signed artifact's
// signature, so there is nothing to copy or paste: the first artifact from
// an unrecognized key pauses in 'unknown-sender' state (see the
// oat-unknown-sender handler below) until the user confirms its fingerprint.
receiver.requireExplicitTrust = true;
receiver.trustedPublicKeys = [];

// Renders lazily on first open rather than at page load, since most visits
// never touch this dropdown.
const qrShare = $<HTMLDetailsElement>('#qr-share');
let qrShareRendered = false;
qrShare.addEventListener('toggle', () => {
  if (!qrShare.open || qrShareRendered) return;
  qrShareRendered = true;
  void QRCode.toCanvas($<HTMLCanvasElement>('#qr-share-canvas'), location.href, { width: 200, margin: 1 });
});

// --- Receiver policy presets --------------------------------------------
// Demonstrates the granular per-profile ReceiverUiPolicy system (M4) live:
// each preset touches ui-policy, requireSignatureFor, approvalPolicy, and
// autoApprove together so switching actually changes end-to-end behavior,
// not just one knob in isolation.
const POLICY_PRESETS: Record<string, {
  uiPolicy: 'safe' | 'none';
  requireSignatureFor: ('safe-view' | 'safe-html')[];
  approval: Partial<Record<'safe-view' | 'safe-html', 'automatic' | 'prompt' | 'prompt-with-warning'>>;
  autoApprove: string[];
}> = {
  safe: { uiPolicy: 'safe', requireSignatureFor: [], approval: {}, autoApprove: [] },
  strict: {
    uiPolicy: 'safe',
    requireSignatureFor: ['safe-view', 'safe-html'],
    approval: { 'safe-view': 'prompt-with-warning', 'safe-html': 'prompt-with-warning' },
    autoApprove: []
  },
  permissive: {
    uiPolicy: 'safe',
    requireSignatureFor: [],
    approval: { 'safe-view': 'automatic', 'safe-html': 'automatic' },
    autoApprove: ['agent.session.import', 'calendar.event.create']
  },
  'locked-down': { uiPolicy: 'none', requireSignatureFor: [], approval: {}, autoApprove: [] }
};

function applyPolicyPreset(name: string): void {
  const preset = POLICY_PRESETS[name] ?? (POLICY_PRESETS.safe as NonNullable<(typeof POLICY_PRESETS)['safe']>);
  receiver.setAttribute('ui-policy', preset.uiPolicy);
  receiver.requireSignatureFor = preset.requireSignatureFor;
  receiver.approvalPolicy = preset.approval;
  receiver.autoApprove = preset.autoApprove;
  log(receiverLog, 'policy preset applied:', name);
}
applyPolicyPreset('safe');
$<HTMLSelectElement>('#policy-preset').addEventListener('change', (e) => {
  applyPolicyPreset((e.target as HTMLSelectElement).value);
});

// --- Payload-type field visibility -------------------------------------

function updateFieldVisibility(): void {
  const isMessage = payloadTypeSelect.value === 'message';
  const isFile = payloadTypeSelect.value === 'file';
  $<HTMLElement>('#message-field').hidden = !isMessage;
  $<HTMLElement>('#proposal-field').hidden = !isMessage;
  $<HTMLElement>('#file-field').hidden = !isFile;
  $<HTMLElement>('#file-estimate').hidden = !isFile;
}
payloadTypeSelect.addEventListener('change', updateFieldVisibility);
updateFieldVisibility();

const fileEstimateEl = $<HTMLElement>('#file-estimate');
$<HTMLInputElement>('#file-input').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) {
    fileEstimateEl.textContent = '';
    return;
  }
  const seconds = estimateTransferSeconds(file.size);
  if (file.size > MAX_FILE_BYTES) {
    fileEstimateEl.textContent = `${file.name} is ${Math.round(file.size / 1000)} KB — too large for this demo (limit 300 KB, ~700 KB/min over this channel). Pick a smaller file.`;
  } else if (file.size > WARN_FILE_BYTES) {
    fileEstimateEl.textContent = `${file.name} — ${Math.round(file.size / 1000)} KB, ~${seconds}s to transfer at the default frame rate.`;
  } else {
    fileEstimateEl.textContent = `${file.name} — ${file.size} bytes, ~${seconds}s to transfer.`;
  }
});

// --- M5 bootstrap state: fresh RTCPeerConnections per WebRTC-offer demo run

let offererPc: RTCPeerConnection | null = null;
let answererPc: RTCPeerConnection | null = null;
let offererChannel: RTCDataChannel | null = null;

function resetWebrtcDemo(): void {
  offererChannel?.close();
  offererPc?.close();
  answererPc?.close();
  offererPc = new RTCPeerConnection();
  answererPc = new RTCPeerConnection();
  offererChannel = offererPc.createDataChannel('oat-demo');
  offererChannel.addEventListener('open', () => {
    log(receiverLog, 'webrtc: data channel open, sending ping');
    offererChannel?.send('ping from offerer');
  });
  answererPc.addEventListener('datachannel', (e) => {
    const channel = e.channel;
    channel.addEventListener('message', (msg) => {
      log(receiverLog, 'webrtc: answerer received:', msg.data);
      channel.send('pong from answerer');
    });
  });
  offererChannel.addEventListener('message', (msg) => log(receiverLog, 'webrtc: offerer received:', msg.data));
}

// --- Sender wiring ---------------------------------------------------

$<HTMLButtonElement>('#prepare-btn').addEventListener('click', async () => {
  const payloadType = payloadTypeSelect.value;
  sender.stop();

  // release-manifest/webrtc-offer/unsafe-demo build (and sign) their own
  // artifact directly and hand it to sender.sendArtifact() — sender.signingKey
  // only matters for the 'message' path below, which builds through
  // sender.source, so it's set there based on the sign-toggle checkbox.

  if (payloadType === 'file') {
    const file = $<HTMLInputElement>('#file-input').files?.[0];
    if (!file) {
      log(senderLog, 'no file selected');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      log(senderLog, 'file too large for this demo:', file.size, 'bytes');
      return;
    }
    const sign = $<HTMLInputElement>('#sign-toggle').checked;
    if (sign) {
      sender.signingKey = signingKey;
      sender.setAttribute('verify', 'signature');
    } else {
      sender.signingKey = null;
      sender.removeAttribute('verify');
    }
    // A raw file transfer proposes no UI — detach the agent-handoff
    // <template> (always present in the sender's light DOM) so
    // buildUiProposal() doesn't attach it to an unrelated artifact. Waits
    // for prepare() to actually finish reading the template before
    // restoring it — see waitForPrepared().
    proposalTemplate.remove();
    // Tags the artifact so the receiver can distinguish "this came from the
    // file input" from any other mediaType-alike artifact (e.g. the JSON
    // placeholder payload the unsafe-demo/structured-form proposals carry) —
    // more robust than inferring it from mediaType alone.
    sender.metadata = { oatDemoKind: 'file' };
    sender.source = file; // Blob — resolveSource() picks up file.type automatically
    await waitForPrepared(sender);
    sender.appendChild(proposalTemplate);
    return;
  }

  if (payloadType === 'structured-form') {
    sender.removeAttribute('verify'); // signs directly below, like unsafe-demo
    // The 'form' safe-view kind is fully implemented (packages/ui's
    // renderSafeView -> renderFormView) but nothing in this demo exercised
    // it before now — the agent-handoff proposal above uses raw HTML
    // through safe-html instead. This is a genuinely declarative form: no
    // HTML at all, just typed fields the receiver renders itself.
    const proposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: crypto.randomUUID(),
      origin: { id: 'demo-sender', label: 'Structured-form demo sender' },
      title: 'Schedule a follow-up',
      summary: 'A declarative form — no HTML at all.',
      preferredView: {
        kind: 'form',
        title: 'Schedule a follow-up',
        schema: {
          type: 'object',
          properties: { title: { type: 'string' }, date: { type: 'string' } },
          required: ['title', 'date']
        },
        fields: [
          { name: 'title', label: 'Title', type: 'text', required: true, defaultValue: 'Follow up on handoff' },
          { name: 'date', label: 'Date (YYYY-MM-DD)', type: 'text', required: true, defaultValue: '2026-08-20' }
        ],
        submitAction: 'calendar.event.create',
        submitLabel: 'Add to calendar',
        cancelLabel: 'No thanks'
      },
      fallbackView: { kind: 'text', body: 'This sender wanted to propose scheduling a calendar follow-up.' },
      requestedCapabilities: [{ capability: 'calendar.event.create', reason: 'Add a calendar reminder for this handoff follow-up' }],
      requestedProfile: 'safe-view'
    };
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal: proposal,
      sign: { secretKey: signingKey.secretKey, keyId: 'structured-form-key' }
    });
    log(senderLog, 'built structured-form (safe-view) demo artifact');
    sender.sendArtifact(artifact);
    return;
  }

  if (payloadType === 'release-manifest') {
    sender.removeAttribute('verify'); // buildReleaseManifestArtifact signs directly below
    const fixtureUrl = new URL('/release-fixture.txt', location.href).toString();
    const fixtureBytes = new Uint8Array(await (await fetch(fixtureUrl)).arrayBuffer());
    const manifest = {
      version: 1 as const,
      name: 'demo-release',
      releaseId: crypto.randomUUID(),
      artifacts: [
        {
          name: 'release-fixture.txt',
          mediaType: 'text/plain',
          size: fixtureBytes.length,
          digest: computeDigest(fixtureBytes),
          urls: [fixtureUrl]
        }
      ]
    };
    const artifact = await buildReleaseManifestArtifact(manifest, { sign: { secretKey: signingKey.secretKey, keyId: 'release-key' } });
    log(senderLog, 'built release-manifest artifact:', { releaseId: manifest.releaseId, artifacts: manifest.artifacts.length });
    sender.sendArtifact(artifact);
    return;
  }

  if (payloadType === 'webrtc-offer') {
    sender.removeAttribute('verify');
    resetWebrtcDemo();
    const artifact = await createOfferArtifact(offererPc as RTCPeerConnection, { sign: { secretKey: signingKey.secretKey, keyId: 'webrtc-key' } });
    log(senderLog, 'built WebRTC offer artifact (real RTCPeerConnection, real ICE gathering)');
    sender.sendArtifact(artifact);
    return;
  }

  if (payloadType === 'unsafe-demo') {
    sender.removeAttribute('verify');
    const proposal: UiProposalEnvelope = {
      type: 'ui.proposal',
      version: 1,
      proposalId: crypto.randomUUID(),
      origin: { id: 'demo-sender', label: 'Break-glass demo sender' },
      title: 'Break-glass demo',
      summary: 'Attempts an unauthorized capability and a parent-document read — both must be blocked.',
      preferredView: { kind: 'sandboxed-html', html: ADVERSARIAL_SANDBOX_HTML },
      fallbackView: { kind: 'text', body: 'This sender wanted to show unsandboxed HTML; your receiver policy did not allow it.' },
      requestedCapabilities: [{ capability: 'html.storage', reason: 'adversarial test — should be denied' }],
      requestedProfile: 'sandboxed-html'
    };
    const artifact = await buildArtifact({
      mediaType: 'application/json',
      payload: new TextEncoder().encode('{}'),
      uiProposal: proposal,
      sign: { secretKey: signingKey.secretKey, keyId: 'unsafe-demo-key' }
    });
    log(senderLog, 'built signed break-glass demo artifact');
    sender.sendArtifact(artifact);
    return;
  }

  // payloadType === 'message'
  const message = $<HTMLTextAreaElement>('#message').value;
  const sign = $<HTMLInputElement>('#sign-toggle').checked;
  const includeProposal = $<HTMLInputElement>('#proposal-toggle').checked;

  if (sign) {
    sender.signingKey = signingKey;
    sender.setAttribute('verify', 'signature');
  } else {
    sender.signingKey = null;
    sender.removeAttribute('verify');
  }

  // The proposal <template> is only read at prepare()-time, so toggling it
  // off just means temporarily detaching it before setting `source` and
  // waiting for prepare() to actually finish reading it — see waitForPrepared().
  if (!includeProposal) proposalTemplate.remove();
  sender.metadata = undefined; // clear any oatDemoKind left over from a prior file send
  sender.source = message;
  if (!includeProposal) {
    await waitForPrepared(sender);
    sender.appendChild(proposalTemplate);
  }
});

sender.addEventListener('oat-manifest-ready', ((e: CustomEvent) => {
  log(senderLog, 'manifest ready:', e.detail);
  sender.start();
}) as EventListener);

sender.addEventListener('oat-error', ((e: CustomEvent) => log(senderLog, 'error:', e.detail?.error?.message ?? e.detail)) as EventListener);

// --- Local loopback: read the sender's own rendered canvas each frame and
// feed it into the receiver exactly as a phone camera would. This is what
// makes the demo runnable and verifiable without physical camera hardware.
let loopbackActive = false;
function onSenderProgress(): void {
  if (!loopbackActive) return;
  const canvas = sender.shadowRoot?.querySelector('canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  receiver.processFrame(image);
}
sender.addEventListener('oat-progress', onSenderProgress);

$<HTMLButtonElement>('#loopback-btn').addEventListener('click', () => {
  loopbackActive = true;
  log(receiverLog, 'local loopback started (reading sender canvas frames directly)');
});

$<HTMLButtonElement>('#camera-btn').addEventListener('click', () => {
  loopbackActive = false;
  void receiver.start();
});

$<HTMLButtonElement>('#reset-btn').addEventListener('click', () => {
  receiver.reset();
  proposalHost.replaceChildren();
  capabilityHost.replaceChildren();
  trustHost.replaceChildren();
  resultMedia.replaceChildren();
  revokeLastResultObjectUrl();
  resultEl.hidden = false;
  resultEl.textContent = '(nothing received yet)';
});

// --- Receiver wiring ---------------------------------------------------

receiver.addEventListener('oat-state-change', ((e: CustomEvent) => log(receiverLog, 'state:', e.detail.state)) as EventListener);
receiver.addEventListener('oat-error', ((e: CustomEvent) => log(receiverLog, 'error:', e.detail?.error?.message ?? e.detail)) as EventListener);

receiver.addEventListener('oat-rejected', ((e: CustomEvent) => {
  log(receiverLog, 'rejected:', e.detail?.verification?.reasons ?? e.detail?.reasons);
  resultEl.textContent = `Rejected: ${JSON.stringify(e.detail?.verification?.reasons ?? e.detail?.reasons)}`;
}) as EventListener);

// Trust-on-first-use: the artifact's digest and signature already checked out
// — the only thing missing is that this receiver hasn't seen this signer's
// public key before. Pause here and let the user confirm the fingerprint
// rather than silently trusting or silently rejecting.
receiver.addEventListener('oat-unknown-sender', ((e: CustomEvent) => {
  const { publicKeyHex } = e.detail;
  log(receiverLog, 'unknown sender, awaiting trust confirmation:', publicKeyHex);
  renderTrustPrompt({
    container: trustHost,
    publicKeyHex,
    onTrust: () => {
      trustHost.replaceChildren();
      log(receiverLog, 'sender trusted:', publicKeyHex);
      receiver.trustSenderAndContinue();
    },
    onReject: () => {
      trustHost.replaceChildren();
      receiver.rejectUnknownSender();
    }
  });
}) as EventListener);

receiver.addEventListener('oat-consent-required', ((e: CustomEvent) => {
  const { proposal, decision } = e.detail;
  log(receiverLog, 'consent required:', { approvalMode: decision.approvalMode, proposalId: proposal.proposalId });

  proposalHost.replaceChildren();
  const panel = document.createElement('div');
  const msg = document.createElement('p');
  msg.textContent = `"${proposal.title}" is ready to render (approvalMode: ${decision.approvalMode}) — confirm to show it.`;
  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.textContent = 'Confirm & render';
  confirmBtn.addEventListener('click', () => receiver.confirmProposal());
  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.addEventListener('click', () => receiver.dismissProposal('user-dismissed'));
  panel.append(msg, confirmBtn, dismissBtn);
  proposalHost.appendChild(panel);
}) as EventListener);

receiver.addEventListener('oat-artifact', (async (e: CustomEvent) => {
  const { artifact, verification } = e.detail;
  log(receiverLog, 'artifact delivered:', { mediaType: artifact.mediaType, valid: verification.valid });

  if (artifact.mediaType === RELEASE_MANIFEST_MEDIA_TYPE) {
    const manifest = await extractReleaseManifest(artifact, verification);
    resultEl.textContent = `Release manifest "${manifest.name}" (${manifest.releaseId}) — fetching & verifying ${manifest.artifacts.length} artifact(s)...`;
    try {
      // The library default (https: only) is an SSRF guard against arbitrary
      // sender-controlled hosts. This demo's fixture is fetched from its own
      // origin (see the fixtureUrl construction above), which is why widening
      // to allow http: here is safe — a real consumer fetching third-party
      // mirrors should keep the strict default.
      const results = await fetchAndVerifyManifest(manifest, { allowedUrlSchemes: ['https:', 'http:'] });
      resultEl.textContent = results
        .map((r) => `${r.entry.name}: verified ${r.bytes.length} bytes from ${r.urlUsed}\n\n${new TextDecoder().decode(r.bytes)}`)
        .join('\n---\n');
    } catch (err) {
      resultEl.textContent = `Bootstrap fetch failed: ${(err as Error).message}`;
    }
    return;
  }

  if (artifact.mediaType === WEBRTC_BOOTSTRAP_MEDIA_TYPE) {
    resultEl.textContent = 'WebRTC offer received optically — creating answer and completing the connection...';
    try {
      const answerArtifact = await createAnswerArtifact(answererPc as RTCPeerConnection, artifact, verification, {
        sign: { secretKey: signingKey.secretKey, keyId: 'webrtc-key' }
      });
      log(
        receiverLog,
        'webrtc: answer created (this demo applies it directly — a real cross-device flow would send it back optically too)'
      );
      // The answer was just built locally (not received optically), so there's no receiver-side
      // `verification` for it — verify it the same way any recipient of this artifact would.
      const answerVerification = verifyArtifact(answerArtifact, { requireSignature: true });
      await applyAnswerArtifact(offererPc as RTCPeerConnection, answerArtifact, answerVerification);
      resultEl.textContent = 'WebRTC answer applied. Watch the log below for the live data-channel ping/pong.';
    } catch (err) {
      resultEl.textContent = `WebRTC bootstrap failed: ${(err as Error).message}`;
    }
    return;
  }

  const bytes = await extractPayload(artifact);

  // Tagged by the sender's #prepare-btn 'file' branch (see sender.metadata
  // above) — distinguishes a real file transfer from any other artifact that
  // happens to share a mediaType (e.g. the JSON placeholder payload the
  // unsafe-demo/structured-form proposals carry).
  if (artifact.metadata?.oatDemoKind === 'file') {
    revokeLastResultObjectUrl();
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: artifact.mediaType || 'application/octet-stream' }));
    lastResultObjectUrl = url;
    resultEl.hidden = true;
    if (artifact.mediaType.startsWith('image/')) {
      resultMedia.replaceChildren(Object.assign(new Image(), { src: url, alt: 'Received file' }));
    } else {
      const link = Object.assign(document.createElement('a'), {
        href: url,
        download: 'received-file',
        textContent: `Download received file (${bytes.length} bytes, ${artifact.mediaType})`
      });
      resultMedia.replaceChildren(link);
    }
    return;
  }

  resultEl.hidden = false;
  resultMedia.replaceChildren();
  resultEl.textContent = new TextDecoder().decode(bytes);
}) as unknown as EventListener);

// Minimal iCalendar (RFC 5545) VEVENT builder — just enough to produce a
// downloadable .ics that Calendar/Outlook/etc. will accept.
function buildIcs(title: string, date: string): string {
  const escape = (s: string) => s.replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const dateStamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replace(/-/g, '') : dateStamp.slice(0, 8);
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//optical-artifact-transport demo//EN',
    'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}`,
    `DTSTAMP:${dateStamp}`,
    `DTSTART;VALUE=DATE:${eventDate}`,
    `SUMMARY:${escape(title)}`,
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ].join('\r\n');
}

function handleUiAction(action: UiActionRequest): void {
  log(receiverLog, 'ui action:', action);
  if (action.action === 'reject') proposalHost.replaceChildren();

  // Re-check the capability against the live policy engine rather than
  // trusting the action payload — the same principle checkCapability() is
  // built for (the M6 sandbox bridge mediates each request the same way):
  // a submit action naming a capability is not proof it was actually granted.
  if (action.action === 'submit' && action.capability === 'calendar.event.create' && receiver.checkCapability('calendar.event.create')) {
    const data = action.data ?? {};
    const title = typeof data.title === 'string' && data.title ? data.title : 'Event';
    const date = typeof data.date === 'string' ? data.date : '';
    const ics = buildIcs(title, date);
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'event.ics' });
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(receiverLog, 'calendar.event.create: downloaded event.ics for', { title, date });
  }
}

receiver.addEventListener('oat-ui-proposal', ((e: CustomEvent) => {
  const { proposal, decision } = e.detail;
  log(receiverLog, 'ui proposal:', { outcome: decision.outcome, effectiveCapabilities: decision.effectiveCapabilities });

  if (decision.outcome === 'downgrade') {
    renderSafeView(proposalHost, proposal.fallbackView, { proposalId: proposal.proposalId }, handleUiAction);
    capabilityHost.replaceChildren();
    return;
  }

  if (decision.outcome === 'accept-unsafe') {
    capabilityHost.replaceChildren();
    renderUnsafeOptInPrompt({
      container: proposalHost,
      originLabel: proposal.origin.label ?? proposal.origin.id,
      onActivate: () => {
        mountSandboxedHtml(proposalHost, {
          view: proposal.preferredView,
          onRequest: (request, respond) => {
            log(receiverLog, 'sandbox request:', request);
            if (request.type === 'request.capability') {
              const allowed = receiver.checkCapability(request.capability);
              log(receiverLog, `sandbox capability "${request.capability}":`, allowed ? 'ALLOWED' : 'DENIED');
              respond({ type: 'capability.result', requestId: request.requestId, capability: request.capability, allowed });
            } else if (request.type === 'request.action') {
              // This demo denies every sandboxed action outright — a real host would route this
              // through the same policy/consent flow as ui.action.* capabilities.
              respond({ type: 'action.result', requestId: request.requestId, status: 'denied' });
            }
          }
        });
      },
      onCancel: () => proposalHost.replaceChildren()
    });
    return;
  }

  const missingCapabilities = proposal.requestedCapabilities
    .map((c: { capability: string }) => c.capability)
    .filter((cap: string) => !decision.effectiveCapabilities.includes(cap));

  const renderProposal = () => {
    if (proposal.preferredView.kind === 'safe-html') {
      renderSafeHtml(proposalHost, proposal.preferredView, { proposalId: proposal.proposalId }, handleUiAction);
    } else {
      renderSafeView(proposalHost, proposal.preferredView, { proposalId: proposal.proposalId }, handleUiAction);
    }
  };

  if (missingCapabilities.length > 0) {
    renderCapabilityPrompt({
      container: capabilityHost,
      proposal,
      onDecision: (approved, accepted) => {
        capabilityHost.replaceChildren();
        if (!accepted) return;
        receiver.approveCapabilities(approved);
        renderProposal();
      }
    });
  } else {
    renderProposal();
  }
}) as EventListener);

// --- Decision echo: after the receiver settles on a UI decision, build a
// signed ui.decision artifact and send it back optically — this small pair
// of elements plays "the original sender's inbox" receiving it, closing the
// loop the design doc's acceptance algorithm calls for (step 7).

const decisionSender = $<OpticalSendElement>('#decision-sender');
const decisionReceiverEl = $<OpticalReceiveElement>('#decision-receiver');
const decisionLog = $<HTMLPreElement>('#decision-log');

decisionReceiverEl.trustedPublicKeys = [toHex(signingKey.publicKey)];
decisionReceiverEl.setAttribute('verify', 'signature');

let decisionLoopbackActive = false;
decisionSender.addEventListener('oat-progress', () => {
  if (!decisionLoopbackActive) return;
  const canvas = decisionSender.shadowRoot?.querySelector('canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  decisionReceiverEl.processFrame(ctx.getImageData(0, 0, canvas.width, canvas.height));
});

decisionReceiverEl.addEventListener('oat-artifact', (async (e: CustomEvent) => {
  const { artifact, verification } = e.detail;
  try {
    const decision = await extractUiDecision(artifact, verification);
    log(decisionLog, 'sender received signed decision:', decision);
  } catch (err) {
    log(decisionLog, 'failed to extract decision:', (err as Error).message);
  }
}) as unknown as EventListener);

receiver.addEventListener('oat-ui-proposal', (async () => {
  try {
    decisionSender.stop();
    decisionReceiverEl.reset();
    const decisionArtifact = await receiver.buildDecisionArtifact({
      secretKey: signingKey.secretKey,
      keyId: 'receiver-decision-key'
    });
    decisionLoopbackActive = true;
    decisionSender.sendArtifact(decisionArtifact);
  } catch (err) {
    log(decisionLog, 'failed to build decision artifact:', (err as Error).message);
  }
}) as EventListener);
