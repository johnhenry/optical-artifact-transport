import { buildArtifact, extractPayload, type BuildArtifactOptions, type OatArtifact } from '@johnhenry/oat-protocol';
import { assertVerified, type BootstrapVerification } from './require-verified.js';

export const WEBRTC_BOOTSTRAP_MEDIA_TYPE = 'application/vnd.oat.webrtc-bootstrap+json';

export interface WebrtcBootstrapPayload {
  role: 'offer' | 'answer';
  sdp: string;
  candidates: RTCIceCandidateInit[];
}

function serializePayload(payload: WebrtcBootstrapPayload): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(payload));
}

function deserializePayload(bytes: Uint8Array): WebrtcBootstrapPayload {
  const payload = JSON.parse(new TextDecoder().decode(bytes)) as WebrtcBootstrapPayload;
  if (payload.role !== 'offer' && payload.role !== 'answer') {
    throw new Error('webrtc-bootstrap: malformed payload (bad role)');
  }
  return payload;
}

/**
 * Waits for ICE gathering to finish (or `timeoutMs`) and returns every
 * candidate collected. Animated-QR transport moves one bounded artifact at
 * a time, not a live stream — a poor fit for trickle ICE — so this trades a
 * little extra setup latency for a self-contained, single-shot payload.
 */
export function gatherIceCandidates(pc: RTCPeerConnection, timeoutMs = 3000): Promise<RTCIceCandidateInit[]> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve([]);

  const candidates: RTCIceCandidateInit[] = [];
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icecandidate', onCandidate);
      pc.removeEventListener('icegatheringstatechange', onStateChange);
      clearTimeout(timer);
      resolve(candidates);
    };
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (e.candidate) candidates.push(e.candidate.toJSON());
      else finish(); // a null candidate signals end-of-candidates
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    pc.addEventListener('icecandidate', onCandidate);
    pc.addEventListener('icegatheringstatechange', onStateChange);
    const timer = setTimeout(finish, timeoutMs);
  });
}

export interface WebrtcArtifactOptions {
  sign?: BuildArtifactOptions['sign'];
  iceTimeoutMs?: number;
}

/** Creates a local offer, gathers ICE candidates, and wraps both as an OAT artifact ready to send optically. */
export async function createOfferArtifact(pc: RTCPeerConnection, options: WebrtcArtifactOptions = {}): Promise<OatArtifact> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  const candidates = await gatherIceCandidates(pc, options.iceTimeoutMs);

  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error('webrtc-bootstrap: localDescription missing after setLocalDescription');

  const payload: WebrtcBootstrapPayload = { role: 'offer', sdp, candidates };
  return buildArtifact({ mediaType: WEBRTC_BOOTSTRAP_MEDIA_TYPE, payload: serializePayload(payload), sign: options.sign });
}

/**
 * Applies a received offer artifact, creates the matching answer, and wraps
 * it as an OAT artifact. `verification` must come from having already
 * verified `offerArtifact` — an unsigned/unverified "offer" could otherwise
 * drive `setRemoteDescription`/`addIceCandidate` with attacker-supplied
 * session data.
 */
export async function createAnswerArtifact(
  pc: RTCPeerConnection,
  offerArtifact: OatArtifact,
  verification: BootstrapVerification,
  options: WebrtcArtifactOptions = {}
): Promise<OatArtifact> {
  const offer = await extractWebrtcBootstrapPayload(offerArtifact, verification);
  if (offer.role !== 'offer') throw new Error('createAnswerArtifact: expected an "offer" artifact');

  await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
  for (const candidate of offer.candidates) await pc.addIceCandidate(candidate);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  const candidates = await gatherIceCandidates(pc, options.iceTimeoutMs);

  const sdp = pc.localDescription?.sdp;
  if (!sdp) throw new Error('webrtc-bootstrap: localDescription missing after setLocalDescription');

  const payload: WebrtcBootstrapPayload = { role: 'answer', sdp, candidates };
  return buildArtifact({ mediaType: WEBRTC_BOOTSTRAP_MEDIA_TYPE, payload: serializePayload(payload), sign: options.sign });
}

/** Applies a received answer artifact to complete the offering side's connection. `verification` must come from having already verified `answerArtifact`. */
export async function applyAnswerArtifact(
  pc: RTCPeerConnection,
  answerArtifact: OatArtifact,
  verification: BootstrapVerification
): Promise<void> {
  const answer = await extractWebrtcBootstrapPayload(answerArtifact, verification);
  if (answer.role !== 'answer') throw new Error('applyAnswerArtifact: expected an "answer" artifact');

  await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
  for (const candidate of answer.candidates) await pc.addIceCandidate(candidate);
}

/**
 * `verification` must come from `verifyReceivedArtifact`/`verifyArtifact`
 * having already run on `artifact` — this refuses to extract from anything
 * without an affirmatively verified signature, since the payload drives
 * real `RTCPeerConnection` calls (`setRemoteDescription`/`addIceCandidate`).
 */
export async function extractWebrtcBootstrapPayload(
  artifact: OatArtifact,
  verification: BootstrapVerification
): Promise<WebrtcBootstrapPayload> {
  assertVerified(verification, 'webrtc-bootstrap');
  if (artifact.mediaType !== WEBRTC_BOOTSTRAP_MEDIA_TYPE) {
    throw new Error(`webrtc-bootstrap: not a webrtc-bootstrap artifact (mediaType=${artifact.mediaType})`);
  }
  return deserializePayload(await extractPayload(artifact));
}
