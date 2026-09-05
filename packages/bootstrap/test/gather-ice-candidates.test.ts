import { describe, expect, it } from 'vitest';
import { gatherIceCandidates } from '../src/webrtc-bootstrap.js';

/**
 * `webrtc-bootstrap.test.ts`'s `MockRTCPeerConnection` defines
 * `addEventListener()` as an empty method and reports
 * `iceGatheringState === 'complete'`, so both of its `gatherIceCandidates`
 * tests take a path that never registers a listener: one returns early on
 * `'complete'`, the other falls out on the timeout. The whole event-driven
 * body of the function — accumulating candidates, finishing on the null
 * end-of-candidates candidate, finishing on `icegatheringstatechange`, and
 * removing its own listeners — had no coverage at all.
 *
 * This mock is an `EventTarget` that actually dispatches, so those paths
 * run. It is still a mock: no headless environment here has a real
 * `RTCPeerConnection`, and nothing below proves OAT interoperates with one.
 * What it does prove is that the listener bookkeeping is right, which is
 * the part that was previously asserted by nobody.
 */
class FakePeerConnection extends EventTarget {
  iceGatheringState: RTCIceGatheringState = 'new';
  readonly listenerCounts = new Map<string, number>();

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) + 1);
    super.addEventListener(type, listener);
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    this.listenerCounts.set(type, (this.listenerCounts.get(type) ?? 0) - 1);
    super.removeEventListener(type, listener);
  }

  emitCandidate(candidate: RTCIceCandidateInit | null): void {
    const event = new Event('icecandidate') as Event & { candidate: unknown };
    event.candidate = candidate === null ? null : { toJSON: () => candidate };
    this.dispatchEvent(event);
  }

  completeGathering(): void {
    this.iceGatheringState = 'complete';
    this.dispatchEvent(new Event('icegatheringstatechange'));
  }

  get leakedListeners(): number {
    return [...this.listenerCounts.values()].reduce((total, count) => total + count, 0);
  }
}

function candidate(n: number): RTCIceCandidateInit {
  return { candidate: `candidate:${n} 1 udp 2130706431 192.0.2.${n} 5000 typ host`, sdpMLineIndex: 0 };
}

function fake(): { pc: FakePeerConnection; asRtc: RTCPeerConnection } {
  const pc = new FakePeerConnection();
  return { pc, asRtc: pc as unknown as RTCPeerConnection };
}

describe('gatherIceCandidates (event-driven paths)', () => {
  it('accumulates candidates and resolves on the null end-of-candidates signal', async () => {
    const { pc, asRtc } = fake();
    // A timeout far longer than the test's own budget, so that resolving at
    // all is proof the null candidate — not the timer — ended the gather.
    const gathering = gatherIceCandidates(asRtc, 60_000);

    pc.emitCandidate(candidate(1));
    pc.emitCandidate(candidate(2));
    pc.emitCandidate(null);

    expect(await gathering).toEqual([candidate(1), candidate(2)]);
  }, 2_000);

  it('resolves on icegatheringstatechange reaching complete', async () => {
    const { pc, asRtc } = fake();
    const gathering = gatherIceCandidates(asRtc, 60_000);

    pc.emitCandidate(candidate(7));
    pc.completeGathering();

    expect(await gathering).toEqual([candidate(7)]);
  });

  it('ignores an icegatheringstatechange that is not "complete"', async () => {
    const { pc, asRtc } = fake();
    const gathering = gatherIceCandidates(asRtc, 60);

    pc.iceGatheringState = 'gathering';
    pc.dispatchEvent(new Event('icegatheringstatechange'));
    pc.emitCandidate(candidate(3));

    // Still listening — only the timeout ends it.
    expect(pc.leakedListeners).toBe(2);
    expect(await gathering).toEqual([candidate(3)]);
  });

  it('removes both listeners once it resolves', async () => {
    const { pc, asRtc } = fake();
    const gathering = gatherIceCandidates(asRtc, 60_000);
    expect(pc.leakedListeners).toBe(2);

    pc.emitCandidate(null);
    await gathering;

    expect(pc.leakedListeners).toBe(0);
  });

  it('returns what it had when the timeout fires first, and stops listening', async () => {
    const { pc, asRtc } = fake();
    const gathering = gatherIceCandidates(asRtc, 30);

    pc.emitCandidate(candidate(9));

    expect(await gathering).toEqual([candidate(9)]);
    expect(pc.leakedListeners).toBe(0);
  });

  it('does not resolve twice when candidates keep arriving after it finished', async () => {
    const { pc, asRtc } = fake();
    const gathering = gatherIceCandidates(asRtc, 60_000);

    pc.emitCandidate(candidate(1));
    pc.emitCandidate(null);
    const first = await gathering;

    pc.emitCandidate(candidate(2));
    expect(first).toEqual([candidate(1)]);
  });
});
