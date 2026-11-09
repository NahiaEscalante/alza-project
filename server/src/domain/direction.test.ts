import { describe, expect, it } from 'vitest';
import { type DirectionInput, decideDirection, parseYapeHeader } from './direction.js';

const HOLDERS = ['Marta Quispe Huamán'];

function input(overrides: Partial<DirectionInput>): DirectionInput {
  return {
    header: null,
    counterpartyName: null,
    visibleHolderName: null,
    holderRole: 'unknown',
    holders: HOLDERS,
    ...overrides,
  };
}

describe('parseYapeHeader', () => {
  it.each([
    ['¡Te Yapearon!', 'yape_received'],
    ['te yapearon', 'yape_received'],
    ['¡Yapeaste!', 'yape_sent'],
    ['YAPEASTE', 'yape_sent'],
    ['Operación exitosa', null],
    [null, null],
  ])('%s → %s', (header, kind) => {
    expect(parseYapeHeader(header)).toBe(kind);
  });
});

describe('decideDirection: Yape with a legible header (D36)', () => {
  it('«¡Te Yapearon!» from a client → in', () => {
    expect(decideDirection(input({ header: '¡Te Yapearon!', counterpartyName: 'Ana T.' }))).toEqual(
      { kind: 'resolved', direction: 'in', rule: 'yape_received' },
    );
  });

  it('«¡Yapeaste!» to the distributor → out', () => {
    expect(
      decideDirection(input({ header: '¡Yapeaste!', counterpartyName: 'Distribuidora Sur' })),
    ).toEqual({ kind: 'resolved', direction: 'out', rule: 'yape_sent' });
  });

  it('«¡Yapeaste!» to her (a client’s phone) → in', () => {
    expect(decideDirection(input({ header: '¡Yapeaste!', counterpartyName: 'Marta Q.' }))).toEqual({
      kind: 'resolved',
      direction: 'in',
      rule: 'yape_sent_to_her',
    });
  });

  it('«¡Te Yapearon!» whose payer is her own name → direction doubt', () => {
    expect(
      decideDirection(input({ header: '¡Te Yapearon!', counterpartyName: 'Marta Quispe' })),
    ).toEqual({
      kind: 'clarification',
      clarificationType: 'direction',
      rule: 'yape_received_from_her',
    });
  });

  it('the header wins over a contradicting holder role', () => {
    const result = decideDirection(
      input({ header: '¡Te Yapearon!', counterpartyName: 'Ana T.', holderRole: 'payer' }),
    );
    expect(result).toMatchObject({ kind: 'resolved', direction: 'in' });
  });
});

describe('decideDirection: Plin, transfers and Yape without header', () => {
  it('her account received → in', () => {
    expect(
      decideDirection(input({ visibleHolderName: 'Marta Q.', holderRole: 'payee' })),
    ).toMatchObject({ kind: 'resolved', direction: 'in', rule: 'holder_received' });
  });

  it('her account paid → out', () => {
    expect(
      decideDirection(input({ visibleHolderName: 'Marta Quispe H.', holderRole: 'payer' })),
    ).toMatchObject({ kind: 'resolved', direction: 'out', rule: 'holder_paid' });
  });

  it('a client’s account paid her → in', () => {
    expect(
      decideDirection(
        input({
          visibleHolderName: 'Jenny Patricia ...',
          holderRole: 'payer',
          counterpartyName: 'Marta Q.',
        }),
      ),
    ).toMatchObject({ kind: 'resolved', direction: 'in', rule: 'client_paid_her' });
  });

  it('uses an explicit recipient when the reader gives one', () => {
    expect(
      decideDirection(input({ visibleHolderName: 'Luis P.', recipientName: 'Marta Quispe' })),
    ).toMatchObject({ kind: 'resolved', direction: 'in', rule: 'client_paid_her' });
  });

  it.each([
    ['holder matches but role unknown', { visibleHolderName: 'Marta Q.', holderRole: 'unknown' }],
    [
      'someone else paid someone else',
      { visibleHolderName: 'Luis P.', holderRole: 'payer', counterpartyName: 'Ana T.' },
    ],
    ['nothing legible', {}],
    [
      'a stranger received (not from her)',
      { visibleHolderName: 'Luis P.', holderRole: 'payee', counterpartyName: 'Marta Q.' },
    ],
  ] as const)('%s → direction doubt', (_label, overrides) => {
    expect(decideDirection(input(overrides))).toEqual({
      kind: 'clarification',
      clarificationType: 'direction',
      rule: 'unknown',
    });
  });

  it('additional holders count as her (D31)', () => {
    const holders = ['Marta Quispe Huamán', 'Pedro Rojas Vega'];
    expect(
      decideDirection(input({ visibleHolderName: 'Pedro Rojas V.', holderRole: 'payee', holders })),
    ).toMatchObject({ kind: 'resolved', direction: 'in' });
  });
});
