import { describe, expect, it } from 'vitest';
import { correctedEntryFields, findCorrectionTarget } from './corrections.js';
import { entry, lima, screenshotEntry } from './test-support.js';

const NOW = lima('2026-11-10T15:00');

describe('findCorrectionTarget (case 13)', () => {
  it('targets her last entry within 15 minutes', () => {
    const older = entry({ id: 'old', inboundMessageId: 'm1', createdAt: lima('2026-11-10T14:50') });
    const last = entry({ id: 'last', inboundMessageId: 'm2', createdAt: lima('2026-11-10T14:55') });
    expect(findCorrectionTarget([older, last], NOW)).toEqual({ kind: 'target', entryId: 'last' });
  });

  it('nothing in the last 15 minutes → none', () => {
    const old = entry({ inboundMessageId: 'm1', createdAt: lima('2026-11-10T14:44') });
    expect(findCorrectionTarget([old], NOW)).toEqual({ kind: 'none' });
  });

  it('her last message created two entries → ambiguous (doubt)', () => {
    const bread = entry({
      id: 'pan',
      inboundMessageId: 'audio',
      createdAt: lima('2026-11-10T14:58'),
    });
    const soda = entry({
      id: 'gaseosa',
      inboundMessageId: 'audio',
      createdAt: lima('2026-11-10T14:58'),
    });
    expect(findCorrectionTarget([bread, soda], NOW)).toEqual({
      kind: 'ambiguous',
      entryIds: ['pan', 'gaseosa'],
    });
  });

  it('ignores voided, superseded and web/chat entries', () => {
    const voided = entry({
      status: 'voided',
      inboundMessageId: 'm3',
      createdAt: lima('2026-11-10T14:59'),
    });
    const web = entry({ source: 'web', createdAt: lima('2026-11-10T14:59') });
    const real = screenshotEntry({
      id: 'real',
      inboundMessageId: 'm1',
      createdAt: lima('2026-11-10T14:52'),
    });
    expect(findCorrectionTarget([voided, web, real], NOW)).toEqual({
      kind: 'target',
      entryId: 'real',
    });
  });
});

describe('correctedEntryFields (RF-LB-01, D16)', () => {
  it('copies the entry with the new amount, as «lo contaste tú», pointing to the old one', () => {
    const old = screenshotEntry({ id: 'old', amountCents: 5_000 });
    const { id: _id, ...expectedRest } = old;
    const next = correctedEntryFields(old, { amountCents: 5_200, source: 'text' });
    expect(next).toEqual({
      ...expectedRest,
      amountCents: 5_200,
      source: 'text',
      label: 'self_reported',
      replacesEntryId: 'old',
    });
    expect('id' in next).toBe(false);
  });
});
