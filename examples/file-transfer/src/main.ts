import { defineOpticalSend, type OpticalSendElement } from '@oat/sender';
import { defineOpticalReceive, type OpticalReceiveElement } from '@oat/receiver';
import {
  buildArtifact,
  generateSigningKey,
  createCapabilityPolicy,
  computeDigest,
  extractPayload,
  verifyArtifact,
  type UiActionRequest,
  type UiProposalEnvelope
} from '@oat/protocol';
import { renderSafeHtml, renderSafeView, renderCapabilityPrompt, renderUnsafeOptInPrompt, mountSandboxedHtml } from '@oat/ui';
import {
  buildReleaseManifestArtifact,
  extractReleaseManifest,
  fetchAndVerifyManifest,
  RELEASE_MANIFEST_MEDIA_TYPE,
  createOfferArtifact,
  createAnswerArtifact,
  applyAnswerArtifact,
  WEBRTC_BOOTSTRAP_MEDIA_TYPE
} from '@oat/bootstrap';

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
const proposalTemplate = sender.querySelector('template[slot="proposal"]') as HTMLTemplateElement;
const payloadTypeSelect = $<HTMLSelectElement>('#payload-type');

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
  'ui.action.submit'
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
receiver.trustedPublicKeys = [toHex(signingKey.publicKey)];

// --- Payload-type field visibility -------------------------------------

function updateFieldVisibility(): void {
  const isMessage = payloadTypeSelect.value === 'message';
  $<HTMLElement>('#message-field').hidden = !isMessage;
  $<HTMLElement>('#proposal-field').hidden = !isMessage;
}
payloadTypeSelect.addEventListener('change', updateFieldVisibility);
updateFieldVisibility();

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
  // off just means temporarily detaching it before setting `source`.
  if (!includeProposal) proposalTemplate.remove();
  sender.source = message;
  if (!includeProposal) sender.appendChild(proposalTemplate);
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
  resultEl.textContent = '(nothing received yet)';
});

// --- Receiver wiring ---------------------------------------------------

receiver.addEventListener('oat-state-change', ((e: CustomEvent) => log(receiverLog, 'state:', e.detail.state)) as EventListener);
receiver.addEventListener('oat-error', ((e: CustomEvent) => log(receiverLog, 'error:', e.detail?.error?.message ?? e.detail)) as EventListener);

receiver.addEventListener('oat-rejected', ((e: CustomEvent) => {
  log(receiverLog, 'rejected:', e.detail?.verification?.reasons ?? e.detail?.reasons);
  resultEl.textContent = `Rejected: ${JSON.stringify(e.detail?.verification?.reasons ?? e.detail?.reasons)}`;
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
  resultEl.textContent = new TextDecoder().decode(bytes);
}) as unknown as EventListener);

function handleUiAction(action: UiActionRequest): void {
  log(receiverLog, 'ui action:', action);
  if (action.action === 'reject') proposalHost.replaceChildren();
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
