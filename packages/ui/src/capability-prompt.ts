import type { UiProposalEnvelope } from '@oat/protocol';

export interface CapabilityAuditRecord {
  proposalId: string;
  origin: string;
  capabilities: string[];
  accepted: boolean;
  at: string;
}

export interface CapabilityPromptOptions {
  container: Element;
  proposal: UiProposalEnvelope;
  onDecision: (approvedCapabilities: string[], accepted: boolean) => void;
  /** Optional durable-audit hook — the design doc calls for "none, local event, durable receipt". */
  onAudit?: (record: CapabilityAuditRecord) => void;
}

/**
 * Renders a plain-DOM consent panel listing the sender identity, the
 * proposal's title, and every requested capability with its stated reason
 * — nothing here executes sender content. Approving grants *all* requested
 * capabilities; a host wanting per-capability granularity should render its
 * own UI against `proposal.requestedCapabilities` instead of this helper.
 */
export function renderCapabilityPrompt(options: CapabilityPromptOptions): void {
  const { container, proposal, onDecision, onAudit } = options;
  container.replaceChildren();

  const panel = document.createElement('div');
  panel.setAttribute('part', 'trust-panel');

  const heading = document.createElement('h3');
  heading.textContent = proposal.origin.label ?? proposal.origin.id;
  panel.appendChild(heading);

  const title = document.createElement('p');
  title.textContent = proposal.title;
  panel.appendChild(title);

  if (proposal.summary) {
    const summary = document.createElement('p');
    summary.textContent = proposal.summary;
    panel.appendChild(summary);
  }

  if (proposal.requestedCapabilities.length > 0) {
    const list = document.createElement('ul');
    for (const cap of proposal.requestedCapabilities) {
      const item = document.createElement('li');
      item.textContent = cap.reason ? `${cap.capability} — ${cap.reason}` : cap.capability;
      list.appendChild(item);
    }
    panel.appendChild(list);
  }

  const capabilities = proposal.requestedCapabilities.map((c) => c.capability);

  const approveBtn = document.createElement('button');
  approveBtn.type = 'button';
  approveBtn.textContent = 'Approve';
  approveBtn.addEventListener('click', () => {
    onAudit?.({ proposalId: proposal.proposalId, origin: proposal.origin.id, capabilities, accepted: true, at: new Date().toISOString() });
    onDecision(capabilities, true);
  });

  const denyBtn = document.createElement('button');
  denyBtn.type = 'button';
  denyBtn.textContent = 'Deny';
  denyBtn.addEventListener('click', () => {
    onAudit?.({ proposalId: proposal.proposalId, origin: proposal.origin.id, capabilities: [], accepted: false, at: new Date().toISOString() });
    onDecision([], false);
  });

  panel.append(approveBtn, denyBtn);
  container.appendChild(panel);
}
