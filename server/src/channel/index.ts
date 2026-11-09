/**
 * Messaging channel (8.2, D46, D71): interface, Meta limits and payloads, the simulated adapter,
 * Meta, the 360dialog sandbox and Telegram. Every transport implements the same `Channel`;
 * runtime selects one with its matching webhook secrets.
 */

export * from './dialog360.js';
export * from './limits.js';
export * from './meta.js';
export * from './meta-payload.js';
export * from './outbound.js';
export * from './runtime.js';
export * from './signature.js';
export * from './simulator.js';
export * from './telegram.js';
export * from './telegram-api.js';
export * from './telegram-polling.js';
export * from './telegram-update.js';
export * from './types.js';
