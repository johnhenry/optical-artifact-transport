/**
 * Luby Transform (LT) fountain code primitives shared by the encoder and
 * decoder. Both sides derive the *same* degree and neighbor-block indices
 * for a packet from nothing but its 32-bit `seed` and the source block
 * count `k` — so only the seed (4 bytes) needs to travel on the wire, not
 * the neighbor list itself.
 */

/** Deterministic, fast, seedable PRNG (mulberry32). Not cryptographic. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cumulativeCache = new Map<number, number[]>();

/**
 * Robust Soliton degree distribution, returned as a cumulative table where
 * `table[d]` is P(degree <= d). See Luby (2002), "LT Codes".
 */
export function robustSolitonTable(k: number, c = 0.03, delta = 0.5): number[] {
  const cached = cumulativeCache.get(k);
  if (cached) return cached;

  const rho = new Array<number>(k + 1).fill(0);
  rho[1] = 1 / k;
  for (let i = 2; i <= k; i++) rho[i] = 1 / (i * (i - 1));

  const R = Math.max(1, c * Math.log(k / delta) * Math.sqrt(k));
  const tau = new Array<number>(k + 1).fill(0);
  const threshold = Math.max(1, Math.min(k, Math.round(k / R)));
  for (let i = 1; i < threshold; i++) tau[i] = R / (i * k);
  tau[threshold] = (tau[threshold] ?? 0) + (R * Math.log(R / delta)) / k;

  let z = 0;
  const mu = new Array<number>(k + 1).fill(0);
  for (let i = 1; i <= k; i++) {
    mu[i] = (rho[i] ?? 0) + (tau[i] ?? 0);
    z += mu[i] as number;
  }

  const cumulative = new Array<number>(k + 1).fill(0);
  let acc = 0;
  for (let i = 1; i <= k; i++) {
    acc += (mu[i] as number) / z;
    cumulative[i] = acc;
  }
  cumulative[k] = 1; // guard against floating point drift

  cumulativeCache.set(k, cumulative);
  return cumulative;
}

export function sampleDegree(cumulative: number[], rand: () => number): number {
  const x = rand();
  for (let d = 1; d < cumulative.length; d++) {
    if (x <= (cumulative[d] as number)) return d;
  }
  return cumulative.length - 1;
}

/** Picks `degree` distinct block indices from [0, k) using `rand`. */
export function chooseNeighbors(k: number, degree: number, rand: () => number): number[] {
  const bounded = Math.max(1, Math.min(degree, k));
  const indices = new Set<number>();
  while (indices.size < bounded) {
    indices.add(Math.floor(rand() * k));
  }
  return [...indices].sort((a, b) => a - b);
}

/** Derives the neighbor block indices for `seed` — the core LT determinism primitive. */
export function neighborsForSeed(seed: number, k: number): Set<number> {
  const rand = mulberry32(seed);
  const cumulative = robustSolitonTable(k);
  const degree = sampleDegree(cumulative, rand);
  return new Set(chooseNeighbors(k, degree, rand));
}

export function xorInPlace(target: Uint8Array, source: Uint8Array): void {
  for (let i = 0; i < target.length; i++) {
    target[i] = (target[i] as number) ^ (source[i] as number);
  }
}
