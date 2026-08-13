import { describe, expect, it } from 'vitest';
import {
  createAnswerArtifact,
  createOfferArtifact,
  applyAnswerArtifact,
  extractWebrtcBootstrapPayload,
  gatherIceCandidates,
  WEBRTC_BOOTSTRAP_MEDIA_TYPE
} from '../src/webrtc-bootstrap.js';
import type { BootstrapVerification } from '../src/require-verified.js';

const VERIFIED: BootstrapVerification = { valid: true, signatureValid: true };

/**
 * No headless test environment here implements real WebRTC (happy-dom has
 * no RTCPeerConnection), so this mock exercises the artifact-building/
 * parsing plumbing — SDP + candidates round-tripping through a signed OAT
 * artifact, role validation, offer/answer sequencing. Real ICE negotiation
 * and data-channel establishment is verified live in a browser (two real
 * RTCPeerConnections) via the demo app, the same approach used for camera
 * capture elsewhere in this repo.
 */
class MockRTCPeerConnection {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  iceGatheringState: RTCIceGatheringState = 'complete';
  addedCandidates: RTCIceCandidateInit[] = [];

  constructor(private readonly label: string) {}

  addEventListener(): void {}
  removeEventListener(): void {}

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: `offer-sdp-from-${this.label}` };
  }
  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: `answer-sdp-from-${this.label}` };
  }
  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = desc;
  }
  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = desc;
  }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.addedCandidates.push(candidate);
  }
}

function mockPc(label: string): RTCPeerConnection {
  return new MockRTCPeerConnection(label) as unknown as RTCPeerConnection;
}

describe('gatherIceCandidates', () => {
  it('resolves immediately when gathering already completed', async () => {
    const pc = mockPc('x');
    const candidates = await gatherIceCandidates(pc, 5000);
    expect(candidates).toEqual([]);
  });

  it('falls back to the timeout when gathering never completes', async () => {
    const pc = new MockRTCPeerConnection('stuck');
    pc.iceGatheringState = 'new';
    const started = Date.now();
    const candidates = await gatherIceCandidates(pc as unknown as RTCPeerConnection, 30);
    expect(candidates).toEqual([]);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });
});

describe('offer/answer artifact exchange', () => {
  it('carries the offerer SDP through a signed artifact to the answerer, and back', async () => {
    const offerer = mockPc('offerer');
    const answerer = mockPc('answerer');

    const offerArtifact = await createOfferArtifact(offerer);
    expect(offerArtifact.mediaType).toBe(WEBRTC_BOOTSTRAP_MEDIA_TYPE);

    const offerPayload = await extractWebrtcBootstrapPayload(offerArtifact, VERIFIED);
    expect(offerPayload.role).toBe('offer');
    expect(offerPayload.sdp).toContain('offerer');

    const answerArtifact = await createAnswerArtifact(answerer, offerArtifact, VERIFIED);
    const answerPayload = await extractWebrtcBootstrapPayload(answerArtifact, VERIFIED);
    expect(answerPayload.role).toBe('answer');
    expect((answerer as unknown as MockRTCPeerConnection).remoteDescription?.sdp).toContain('offerer');

    await applyAnswerArtifact(offerer, answerArtifact, VERIFIED);
    expect((offerer as unknown as MockRTCPeerConnection).remoteDescription?.sdp).toContain('answerer');
  });

  it('createAnswerArtifact rejects a non-offer artifact', async () => {
    const offerer = mockPc('offerer');
    const answerer = mockPc('answerer');
    const offerArtifact = await createOfferArtifact(offerer);
    const answerArtifact = await createAnswerArtifact(answerer, offerArtifact, VERIFIED);

    await expect(createAnswerArtifact(mockPc('confused'), answerArtifact, VERIFIED)).rejects.toThrow(/expected an "offer"/);
  });

  it('applyAnswerArtifact rejects a non-answer artifact', async () => {
    const offerer = mockPc('offerer');
    const offerArtifact = await createOfferArtifact(offerer);

    await expect(applyAnswerArtifact(offerer, offerArtifact, VERIFIED)).rejects.toThrow(/expected an "answer"/);
  });

  it('extractWebrtcBootstrapPayload rejects an unrelated artifact', async () => {
    const { buildArtifact } = await import('@oat/protocol');
    const other = await buildArtifact({ mediaType: 'text/plain', payload: new TextEncoder().encode('nope') });
    await expect(extractWebrtcBootstrapPayload(other, VERIFIED)).rejects.toThrow(/not a webrtc-bootstrap artifact/);
  });

  it('refuses to process an offer/answer artifact that was not affirmatively verified', async () => {
    const offerer = mockPc('offerer');
    const answerer = mockPc('answerer');
    const offerArtifact = await createOfferArtifact(offerer); // unsigned

    await expect(extractWebrtcBootstrapPayload(offerArtifact, { valid: true, signatureValid: 'absent' })).rejects.toThrow(
      /unsigned or unverified/
    );
    await expect(createAnswerArtifact(answerer, offerArtifact, { valid: false, signatureValid: true })).rejects.toThrow(
      /unsigned or unverified/
    );
  });
});
