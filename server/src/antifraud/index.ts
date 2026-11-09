/**
 * Antifraud (13.4, D22): repeated account holder, same screenshot from different accounts,
 * activity spikes and instant «sí» close replies. Alerts only flag for the panel (RF-AD-02); the
 * only automatic effect is the spec's «esa cuenta no suma puntos hasta la revisión» for a repeated
 * holder, applied by the 12:00 job.
 */
export * from './holder-conflict.js';
export * from './rules.js';
export * from './scan.js';
