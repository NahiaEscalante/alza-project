/**
 * WhatsApp channel (8.2, D46): interface, Meta limits and payloads, and the simulated adapter.
 * Both transports implement the same `Channel`; runtime selects their matching webhook secrets.
 */
export * from './limits.js';
export * from './meta.js';
export * from './meta-payload.js';
export * from './outbound.js';
export * from './runtime.js';
export * from './signature.js';
export * from './simulator.js';
export * from './types.js';
