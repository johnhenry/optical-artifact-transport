import {
  buildArtifact,
  verifyArtifact,
  encodeCanonical,
  decodeCanonical,
  computeDigest,
  isOatArtifact,
  type BuildArtifactOptions,
  type OatArtifact,
  type VerificationResult
} from '@oat/protocol';
import {
  prepareSource,
  generatePackets,
  FountainDecoder,
  mulberry32,
  type OatPacket
} from '@oat/qr-fountain';
import { applyImpairments, type ImpairmentConfig } from './channel.js';

export interface SimulateTransportOptions {
  /** Fields forwarded to `buildArtifact` (mediaType, payload, sign, uiProposal, ...). */
  artifact: BuildArtifactOptions;
  /** Fountain source block size in bytes — smaller blocks tolerate more loss but need more frames. */
  blockSize?: number;
  /** Maximum number of packets the sender will ever emit before giving up. */
  frameBudget?: number;
  /** How many leading packets the receiver misses entirely (simulates late join). */
  lateJoinOffset?: number;
  impairments?: ImpairmentConfig;
  /** Seed for all randomness in this run, so results are reproducible ("deterministic test vectors"). */
  seed?: number;
  requireSignature?: boolean;
}

export interface SimulateTransportResult {
  delivered: boolean;
  packetsSent: number;
  packetsSurvivedChannel: number;
  packetsConsumedByReceiver: number;
  decoderProgress: number;
  verification: VerificationResult | null;
  reconstructedArtifact: OatArtifact | null;
}

/**
 * Runs a full sender->channel->receiver simulation for one artifact, purely
 * in software (no camera/canvas involved) — this is the M1 "transport
 * simulator" milestone. Returns enough detail to assert on delivery,
 * overhead, and — critically — that a corrupted delivery is caught by
 * digest/signature verification rather than silently accepted.
 */
export async function simulateTransport(
  options: SimulateTransportOptions
): Promise<SimulateTransportResult> {
  const blockSize = options.blockSize ?? 128;
  const frameBudget = options.frameBudget ?? 500;
  const lateJoinOffset = options.lateJoinOffset ?? 0;
  const seed = options.seed ?? 1;

  const artifact = await buildArtifact(options.artifact);
  const envelopeBytes = encodeCanonical(artifact) as Uint8Array;
  const artifactId = computeDigest(new TextEncoder().encode(artifact.id)).value.slice(0, 16);

  const source = prepareSource(envelopeBytes, blockSize, artifactId);

  const seedRand = mulberry32(seed);
  const nextSeed = () => Math.floor(seedRand() * 0xffffffff);

  const sent: OatPacket[] = [];
  const gen = generatePackets(source, nextSeed);
  for (let i = 0; i < frameBudget; i++) sent.push(gen.next().value);

  const channelRand = mulberry32(seed ^ 0x9e3779b9);
  const survived = applyImpairments(sent, options.impairments ?? {}, channelRand);
  const receivedByReceiver = survived.slice(lateJoinOffset);

  const decoder = new FountainDecoder(source.sourceBlockCount, source.blockSize, source.totalLength);
  let consumed = 0;
  for (const packet of receivedByReceiver) {
    try {
      decoder.addPacket(packet);
    } catch {
      continue; // packet belongs to a different session / is malformed post-corruption
    }
    consumed++;
    if (decoder.isComplete) break;
  }

  if (!decoder.isComplete) {
    return {
      delivered: false,
      packetsSent: sent.length,
      packetsSurvivedChannel: survived.length,
      packetsConsumedByReceiver: consumed,
      decoderProgress: decoder.progress,
      verification: null,
      reconstructedArtifact: null
    };
  }

  const reconstructedBytes = decoder.reconstruct();
  let reconstructedArtifact: OatArtifact | null = null;
  let verification: VerificationResult | null = null;

  try {
    const decoded = decodeCanonical(reconstructedBytes);
    if (isOatArtifact(decoded)) {
      reconstructedArtifact = decoded;
      verification = verifyArtifact(decoded, { requireSignature: options.requireSignature });
    }
  } catch {
    // Reconstructed bytes weren't valid CBOR at all — corruption survived FEC recovery.
  }

  return {
    delivered: verification?.valid ?? false,
    packetsSent: sent.length,
    packetsSurvivedChannel: survived.length,
    packetsConsumedByReceiver: consumed,
    decoderProgress: decoder.progress,
    verification,
    reconstructedArtifact
  };
}
