import { defineOpticalSend, type OpticalSendElement } from '@oat/sender';
import { defineOpticalReceive, type OpticalReceiveElement } from '@oat/receiver';
import { generateSigningKey, createCapabilityPolicy, extractPayload, type UiActionRequest } from '@oat/protocol';
import { renderSafeHtml, renderSafeView, renderCapabilityPrompt } from '@oat/ui';

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

const signingKey = generateSigningKey();

// --- Sender wiring ---------------------------------------------------

$<HTMLButtonElement>('#prepare-btn').addEventListener('click', async () => {
  const message = $<HTMLTextAreaElement>('#message').value;
  const sign = $<HTMLInputElement>('#sign-toggle').checked;
  const includeProposal = $<HTMLInputElement>('#proposal-toggle').checked;

  sender.stop();
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
