/**
 * The codec-only surface: packet framing, the LT code, and the fountain
 * encoder/decoder — everything except QR rendering and QR scanning.
 *
 * Importing this entrypoint (or `./encode` / `./decode`) instead of the
 * package root keeps `qrcode` and `jsqr` out of a bundle that does not use
 * them. The root barrel re-exports all of it and is still the convenient
 * choice for code that both renders and scans.
 */
export * from './packet.js';
export * from './lt.js';
export * from './encoder.js';
export * from './decoder.js';
export * from './scheduler.js';
