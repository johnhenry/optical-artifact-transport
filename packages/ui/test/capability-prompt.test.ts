import { describe, expect, it, vi } from 'vitest';
import type { UiProposalEnvelope } from '@johnhenry/oat-protocol';
import { renderCapabilityPrompt } from '../src/capability-prompt.js';

const proposal: UiProposalEnvelope = {
  type: 'ui.proposal',
  version: 1,
  proposalId: 'prop-1',
  origin: { id: 'sender-1', label: 'Agent Bot' },
  title: 'Import agent handoff',
  summary: 'Resume a task on this device',
  preferredView: { kind: 'text', body: 'x' },
  fallbackView: { kind: 'text', body: 'x' },
  requestedCapabilities: [
    { capability: 'agent.session.import', reason: 'resume the task' },
    { capability: 'html.script' }
  ],
  requestedProfile: 'safe-view'
};

describe('renderCapabilityPrompt', () => {
  it('renders sender identity, title, and each requested capability with its reason', () => {
    const container = document.createElement('div');
    renderCapabilityPrompt({ container, proposal, onDecision: vi.fn() });

    expect(container.textContent).toContain('Agent Bot');
    expect(container.textContent).toContain('Import agent handoff');
    expect(container.textContent).toContain('agent.session.import — resume the task');
    expect(container.textContent).toContain('html.script');
  });

  it('approve grants every requested capability and records an audit entry', () => {
    const container = document.createElement('div');
    const onDecision = vi.fn();
    const onAudit = vi.fn();
    renderCapabilityPrompt({ container, proposal, onDecision, onAudit });

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Approve')!.click();

    expect(onDecision).toHaveBeenCalledWith(['agent.session.import', 'html.script'], true);
    expect(onAudit).toHaveBeenCalledWith(
      expect.objectContaining({ proposalId: 'prop-1', accepted: true, capabilities: ['agent.session.import', 'html.script'] })
    );
  });

  it('deny grants nothing and records an audit entry', () => {
    const container = document.createElement('div');
    const onDecision = vi.fn();
    const onAudit = vi.fn();
    renderCapabilityPrompt({ container, proposal, onDecision, onAudit });

    [...container.querySelectorAll('button')].find((b) => b.textContent === 'Deny')!.click();

    expect(onDecision).toHaveBeenCalledWith([], false);
    expect(onAudit).toHaveBeenCalledWith(expect.objectContaining({ accepted: false, capabilities: [] }));
  });
});
