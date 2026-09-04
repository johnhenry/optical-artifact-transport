import { describe, expect, it } from 'vitest';
import { buildArtifact } from '@johnhenry/oat-protocol';
import {
  applyAnswerArtifact,
  extractWebrtcBootstrapPayload,
  WEBRTC_BOOTSTRAP_MEDIA_TYPE
} from '../src/webrtc-bootstrap.js';
import type { BootstrapVerification } from '../src/require-verified.js';

/**
 * `deserializePayload` used to check `role` and nothing else, even though
 * everything it returns is handed to `setRemoteDescription()` and
 * `addIceCandidate()`. Three shapes got through:
 *
 *   {"role":"answer","sdp":"v=0"}                -> applyAnswerArtifact threw
 *                                                   `TypeError: answer.candidates is not
 *                                                   iterable`, *after* it had already
 *                                                   applied the remote description
 *   {"role":"answer","sdp":{...},"candidates":[]} -> a non-string sdp reached
 *                                                   setRemoteDescription()
 *   {"role":"answer","sdp":"v=0","candidates":"nope"} -> iterating the string fed 'n',
 *                                                   'o', 'p', 'e' to addIceCandidate()
 *
 * and `null` produced `TypeError: Cannot read properties of null` rather
 * than the module's own error. The trusted-sender gate in front of all this
 * means it is defence in depth, not an authentication hole — but the
 * connection should not be half-mutated by a payload the module could have
 * rejected outright.
 */
const VERIFIED: BootstrapVerification = { valid: true, signatureValid: true, senderTrusted: true };

async function artifactOf(body: unknown) {
  return buildArtifact({
    mediaType: WEBRTC_BOOTSTRAP_MEDIA_TYPE,
    payload: new TextEncoder().encode(JSON.stringify(body))
  });
}

describe('webrtc-bootstrap payload validation', () => {
  it.each([
    ['null', null, /not an object/],
    ['an array', [], /not an object/],
    ['a bare string', 'answer', /not an object/],
    ['a bad role', { role: 'whatever', sdp: 'v=0', candidates: [] }, /bad role/],
    ['a missing sdp', { role: 'answer', candidates: [] }, /sdp is not a string/],
    ['a non-string sdp', { role: 'answer', sdp: { nope: 1 }, candidates: [] }, /sdp is not a string/],
    ['missing candidates', { role: 'answer', sdp: 'v=0' }, /candidates is not an array/],
    ['a string for candidates', { role: 'answer', sdp: 'v=0', candidates: 'nope' }, /candidates is not an array/],
    ['a non-object candidate', { role: 'answer', sdp: 'v=0', candidates: ['x'] }, /candidate is not an object/]
  ])('refuses %s', async (_label, body, expected) => {
    await expect(extractWebrtcBootstrapPayload(await artifactOf(body), VERIFIED)).rejects.toThrow(expected);
  });

  it('refuses a payload that is not JSON at all', async () => {
    const artifact = await buildArtifact({
      mediaType: WEBRTC_BOOTSTRAP_MEDIA_TYPE,
      payload: new TextEncoder().encode('{ not json')
    });
    await expect(extractWebrtcBootstrapPayload(artifact, VERIFIED)).rejects.toThrow(/not JSON/);
  });

  it('does not touch the connection when the payload is malformed', async () => {
    const calls: string[] = [];
    const pc = {
      setRemoteDescription: async () => void calls.push('setRemoteDescription'),
      addIceCandidate: async () => void calls.push('addIceCandidate')
    } as unknown as RTCPeerConnection;

    const artifact = await artifactOf({ role: 'answer', sdp: 'v=0' }); // no candidates
    await expect(applyAnswerArtifact(pc, artifact, VERIFIED)).rejects.toThrow(/candidates is not an array/);
    expect(calls).toEqual([]);
  });

  it('still accepts a well-formed payload', async () => {
    const candidates = [{ candidate: 'candidate:1 1 udp 1 192.0.2.1 5000 typ host', sdpMLineIndex: 0 }];
    const payload = await extractWebrtcBootstrapPayload(
      await artifactOf({ role: 'answer', sdp: 'v=0\r\n', candidates }),
      VERIFIED
    );
    expect(payload).toEqual({ role: 'answer', sdp: 'v=0\r\n', candidates });
  });
});
