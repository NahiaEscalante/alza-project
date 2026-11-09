/**
 * The 4 summary image variants of 8.6 (normal, Sunday, no cash, with amounts por confirmar), with
 * the figures of Marta's week (10.3, 11.6). Used by the snapshot tests and `npm run render:preview`.
 */
import type { SummaryImageData } from '../summary-types.js';

export const SUMMARY_VARIANTS = {
  /** Marta's Tuesday (11.6 example). */
  normal: {
    businessDay: '2026-11-10',
    businessName: 'Bodega Sol',
    summary: {
      inCents: 41_200,
      digitalSalesCents: 29_800,
      cashSalesCents: 11_400,
      outCents: 18_000,
      inventoryCents: 15_000,
      expensesCents: 0,
      householdCents: 3_000,
      leftCents: 23_200,
    },
    points: { balance: 85, nextReward: { name: 'Útiles escolares', missingPoints: 15 } },
  },
  sunday: {
    businessDay: '2026-11-15',
    businessName: 'Bodega Sol',
    summary: {
      inCents: 38_650,
      digitalSalesCents: 25_150,
      cashSalesCents: 13_500,
      outCents: 9_500,
      inventoryCents: 6_000,
      expensesCents: 1_500,
      householdCents: 2_000,
      leftCents: 29_150,
    },
    points: { balance: 152, nextReward: { name: 'Descuento en tu proveedor', missingPoints: 48 } },
    week: {
      weekStart: '2026-11-09',
      weekEnd: '2026-11-15',
      inCents: 246_350,
      outCents: 98_500,
      leftCents: 147_850,
      completeCount: 5,
      partialCount: 1,
      noCloseCount: 0,
      pointsEarned: 67,
      streakDays: 12,
      freezesUsed: 0,
      days: [
        { businessDay: '2026-11-09', inCents: 33_800 },
        { businessDay: '2026-11-10', inCents: 41_200 },
        { businessDay: '2026-11-11', inCents: 26_500 },
        { businessDay: '2026-11-12', inCents: 35_050 },
        { businessDay: '2026-11-13', inCents: 29_950 },
        { businessDay: '2026-11-14', inCents: 41_200 },
        { businessDay: '2026-11-15', inCents: 38_650 },
      ],
      comparison: {
        comparable: true,
        inDeltaCents: 21_400,
        outDeltaCents: 3_100,
        leftDeltaCents: 18_300,
      },
    },
  },
  /** Only Yape and Plin that day. */
  'no-cash': {
    businessDay: '2026-11-11',
    businessName: 'Bodega Sol',
    summary: {
      inCents: 26_500,
      digitalSalesCents: 26_500,
      cashSalesCents: 0,
      outCents: 4_500,
      inventoryCents: 0,
      expensesCents: 4_500,
      householdCents: 0,
      leftCents: 22_000,
    },
    points: { balance: 95, nextReward: { name: 'Útiles escolares', missingPoints: 5 } },
  },
  /** A doubt keeps S/ 45 out of the totals, and an outflow is still «por clasificar». */
  pending: {
    businessDay: '2026-11-12',
    businessName: 'Bodega Sol',
    summary: {
      inCents: 35_050,
      digitalSalesCents: 24_050,
      cashSalesCents: 11_000,
      outCents: 21_000,
      inventoryCents: 16_000,
      expensesCents: 2_000,
      householdCents: 1_500,
      unclassifiedCents: 1_500,
      leftCents: 14_050,
      pendingCents: 4_500,
    },
    points: {
      balance: 47,
      nextReward: { name: 'Descuento en compra de mercadería', missingPoints: 3 },
    },
  },
} satisfies Record<string, SummaryImageData>;

export type SummaryVariant = keyof typeof SUMMARY_VARIANTS;

const MAX = 9_999_999;

/** S/ 99 999,99 in every slot, a negative «te quedó», a long name and the big goal. */
export const EXTREME_SUMMARY: SummaryImageData = {
  businessDay: '2026-11-15',
  businessName: 'Bodega y Multiservicios «La Esperanza de San Juan de Lurigancho» E.I.R.L.',
  summary: {
    inCents: MAX,
    digitalSalesCents: MAX,
    cashSalesCents: MAX,
    unknownMethodSalesCents: MAX,
    outCents: MAX,
    inventoryCents: MAX,
    expensesCents: MAX,
    householdCents: MAX,
    unclassifiedCents: MAX,
    leftCents: -MAX,
    pendingCents: MAX,
  },
  points: { balance: 2_499, nextReward: { name: 'Electrodoméstico', missingPoints: 1 } },
  week: {
    weekStart: '2026-11-09',
    weekEnd: '2026-11-15',
    inCents: MAX,
    outCents: MAX,
    leftCents: -MAX,
    completeCount: 6,
    partialCount: 0,
    noCloseCount: 0,
    pointsEarned: 95,
    streakDays: 180,
    freezesUsed: 2,
    comparison: {
      comparable: false,
      text: 'Esta semana no comparo porque faltaron cierres completos',
    },
  },
};

/** Everything at zero: a day with only a doubt. */
export const ZERO_SUMMARY: SummaryImageData = {
  businessDay: '2026-11-10',
  businessName: null,
  summary: {
    inCents: 0,
    digitalSalesCents: 0,
    cashSalesCents: 0,
    outCents: 0,
    inventoryCents: 0,
    expensesCents: 0,
    householdCents: 0,
    leftCents: 0,
    pendingCents: 1_200,
  },
  points: {
    balance: 0,
    nextReward: { name: 'Descuento en compra de mercadería', missingPoints: 50 },
  },
};
