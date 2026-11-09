/**
 * WA-10, the one close message (D06, D37, D50, RF-CI-01..05, 10..13, 12.1):
 *
 * 1. Under a per-user-and-day lock, decide (scheduled: due, 24 h window, PR16; on demand: D39,
 *    D49/D54). Nothing is written when nothing is sent (no «open» row for an empty day).
 * 2. Image (renderSummaryImage → uploadMedia) unless she chose «solo texto» (D27); if it fails,
 *    text only (RF-CI-10). Never AI (D26).
 * 3. Text: summary, informative lines (PR09, PR03, D28, D40, D27), up to 5 doubts by priority while
 *    the whole message fits in 1,024 (caption) or 4,096 (text) characters, the cash question last
 *    (PR08), the reply example, «Tienes k cosas más por revisar en la web», the Sunday block and
 *    the 7-day link.
 * 4. Send, then in the same transaction: doubts `in_message` with their number (the rest of the
 *    day's to the web), `daily_closes` → sent with the expected cash change, the WA id and the
 *    composition, and the D28 notice marked as shown. A failed send rolls everything back.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { getPointsBalance } from '../../account/points.js';
import {
  createAccessLink,
  hasPendingSecurityNotice,
  markSecurityNoticesShown,
  SECURITY_NOTICE_TEXT,
} from '../../auth/index.js';
import {
  clarifications,
  type DailyClose,
  dailyCloses,
  rewards,
  type User,
} from '../../db/schema.js';
import {
  businessDayOf,
  type CloseSelection,
  cashCheckQuestion,
  closeMessageLimit,
  computeIndicators,
  expectedCashChange,
  type IsoDate,
  nextRewardHint,
  onDemandCloseDecision,
  scheduledCloseDecision,
  selectClarificationsForClose,
} from '../../domain/index.js';
import { dayLabel } from '../../ledger/index.js';
import { inTransaction, type Tx } from '../../ledger/types.js';
import {
  ALREADY_SENT_TEXT,
  CLOSE_CATALOG,
  type CloseWeekBlock,
  closeMessageText,
  NOTHING_RECORDED_TEXT,
} from '../../messages/close.js';
import { renderSummaryImage, type SummaryImageData, summaryWeekFrom } from '../../render/index.js';
import {
  type DoubtRow,
  dayActivity,
  doubtAmount,
  doubtQuestion,
  doubtsOfDay,
  liveEntriesOfDay,
  lockCloseDay,
  noticeLines,
  pendingCountExcept,
  previousSentClose,
  textOnlyChanged,
  type WeekData,
  weekForClose,
} from './data.js';
import type { CloseComposition, CloseFlowDeps, CloseSendResult } from './types.js';

export type CloseTrigger = 'scheduled' | 'on_demand';

interface Candidate {
  id: string;
  type: DoubtRow['clarification']['type'];
  amountCents: number | null;
  createdAt: Date;
  question: string;
}

async function lockedClose(tx: Tx, userId: string, day: IsoDate): Promise<DailyClose | null> {
  await lockCloseDay(tx, userId, day);
  const [close] = await tx
    .select()
    .from(dailyCloses)
    .where(and(eq(dailyCloses.userId, userId), eq(dailyCloses.businessDay, day)))
    .for('update');
  return close ?? null;
}

async function pointsForImage(tx: Tx, userId: string): Promise<SummaryImageData['points']> {
  // Sequential: one connection inside the transaction.
  const balance = await getPointsBalance(tx, userId);
  const catalog = await tx
    .select({
      id: rewards.id,
      name: rewards.name,
      costPoints: rewards.costPoints,
      isBig: rewards.isBig,
    })
    .from(rewards)
    .where(eq(rewards.active, true));
  const hint = nextRewardHint(balance, catalog);
  return {
    balance,
    nextReward: hint ? { name: hint.reward.name, missingPoints: hint.missingPoints } : null,
  };
}

function weekBlock(week: WeekData): CloseWeekBlock {
  return {
    inCents: week.summary.indicators.inCents,
    outCents: week.summary.indicators.outCents,
    leftCents: week.summary.indicators.leftCents,
    completeCount: week.summary.completeCount,
    comparison: week.comparison,
  };
}

/**
 * Sends today's close if it is due (scheduled) or right away («cierre», RF-CI-03). Idempotent:
 * a second call for the same day answers `already_sent` (on demand: WA-22).
 */
export async function sendDailyClose(
  deps: CloseFlowDeps,
  input: { user: User; businessDay: IsoDate; trigger: CloseTrigger },
): Promise<CloseSendResult> {
  const { db, logger, channel } = deps;
  const { user, businessDay: day, trigger } = input;
  const now = deps.now();
  const securityPending = await hasPendingSecurityNotice(db, user.id);
  const ctx = (catalogId: string) => ({ userId: user.id, to: user.phoneE164, catalogId });

  const result = await inTransaction(db, async (tx): Promise<CloseSendResult> => {
    const close = await lockedClose(tx, user.id, day);
    const activity = await dayActivity(tx, user.id, day);

    if (trigger === 'scheduled') {
      if (!user.closeTime) return { kind: 'not_due' };
      const { decision } = scheduledCloseDecision({
        now,
        closeTime: user.closeTime,
        lastMessageAt: user.lastMessageAt,
        closeStatus: close?.status ?? null,
        ...activity,
      });
      if (decision !== 'send') return { kind: decision };
    } else {
      const decision = onDemandCloseDecision({ closeStatus: close?.status ?? null, ...activity });
      if (decision === 'already_sent') {
        await channel.sendText(ctx(CLOSE_CATALOG.alreadySent), { body: ALREADY_SENT_TEXT });
        return { kind: 'already_sent' };
      }
      if (decision === 'nothing_recorded') {
        await channel.sendText(ctx(CLOSE_CATALOG.nothingRecorded), { body: NOTHING_RECORDED_TEXT });
        return { kind: 'nothing_recorded' };
      }
    }

    // --- Data -------------------------------------------------------------------------------
    const entries = await liveEntriesOfDay(tx, user.id, day);
    const indicators = computeIndicators(entries);
    const expectedChange = expectedCashChange(entries);
    const cashQuestion = cashCheckQuestion(expectedChange).text;
    const previous = await previousSentClose(tx, user.id, day);
    const changedToText = textOnlyChanged(user.summaryImage, previous);
    const notices = await noticeLines(tx, {
      userId: user.id,
      day,
      entries,
      securityLine: securityPending ? SECURITY_NOTICE_TEXT : null,
      textOnlyChanged: changedToText,
      previousSentAt: previous?.sentAt ?? null,
    });
    const week = await weekForClose(tx, user.id, day, businessDayOf(user.createdAt));
    const doubts = await doubtsOfDay(tx, user.id, day, ['open']);
    const candidates: Candidate[] = doubts.map((row) => ({
      id: row.clarification.id,
      type: row.clarification.type,
      amountCents: doubtAmount(row),
      createdAt: row.clarification.createdAt,
      question: doubtQuestion(row),
    }));
    const elsewhere = await pendingCountExcept(
      tx,
      user.id,
      candidates.map((c) => c.id),
    );
    const link = await createAccessLink(tx, user.id, { baseUrl: deps.baseUrl, now });

    // --- Image (D26, D27, RF-CI-10) ------------------------------------------------------------
    let mediaId: string | null = null;
    let imageFailed = false;
    if (user.summaryImage) {
      // Read before the try: a failed query would abort the transaction, not just the image.
      const points = await pointsForImage(tx, user.id);
      try {
        const render = deps.renderImage ?? renderSummaryImage;
        const png = await render({
          businessDay: day,
          businessName: user.businessName,
          summary: indicators,
          points,
          week: week
            ? summaryWeekFrom(week.summary, { comparison: week.comparison, days: week.days })
            : null,
        });
        mediaId = (await channel.uploadMedia({ bytes: png, mimeType: 'image/png' })).mediaId;
      } catch (err) {
        imageFailed = true;
        logger.warn(
          { err, userId: user.id, businessDay: day },
          'summary image failed, close goes as text',
        );
      }
    }

    // --- Text (D37, D50) --------------------------------------------------------------------------
    const compose = (maxLength: number): CloseSelection<Candidate> =>
      selectClarificationsForClose({
        clarifications: candidates,
        maxLength,
        render: (selected, webCount) =>
          closeMessageText({
            dayLabel: dayLabel(day),
            summary: indicators,
            notices: notices.lines,
            doubts: selected.map((c) => ({ type: c.type, text: c.question })),
            cashQuestion,
            webCount: webCount + elsewhere,
            week: week ? weekBlock(week) : null,
            link: link.url,
          }),
      });
    let selection = compose(closeMessageLimit(mediaId !== null));
    if (!selection.fits && mediaId !== null) {
      // Not even the bare message fits a caption: same close as text (4,096).
      mediaId = null;
      selection = compose(closeMessageLimit(false));
    }
    if (!selection.fits) throw new Error('close message does not fit');

    const sent =
      mediaId !== null
        ? await channel.sendImage(ctx(CLOSE_CATALOG.close), { mediaId, caption: selection.text })
        : await channel.sendText(ctx(CLOSE_CATALOG.close), { body: selection.text });

    // --- Persist -------------------------------------------------------------------------------
    for (const [i, c] of selection.inMessage.entries()) {
      await tx
        .update(clarifications)
        .set({ status: 'in_message', messageNumber: i + 1 })
        .where(eq(clarifications.id, c.id));
    }
    const toWeb = selection.toWeb.map((c) => c.id);
    if (toWeb.length > 0) {
      await tx
        .update(clarifications)
        .set({ status: 'in_web' })
        .where(and(inArray(clarifications.id, toWeb), eq(clarifications.status, 'open')));
    }
    const composition: CloseComposition = {
      format: mediaId !== null ? 'image' : 'text',
      summaryImage: user.summaryImage,
      imageFailed,
      weeklySummaryWeek: week?.monday ?? null,
      doubtsInMessage: selection.inMessage.length,
      webCount: selection.toWeb.length + elsewhere,
      notices: notices.kinds,
    };
    const values = {
      status: 'sent' as const,
      sentAt: now,
      expectedCashChangeCents: expectedChange,
      closeWaMessageId: sent.waMessageId,
      composition,
    };
    const [row] = close
      ? await tx.update(dailyCloses).set(values).where(eq(dailyCloses.id, close.id)).returning()
      : await tx
          .insert(dailyCloses)
          .values({ userId: user.id, businessDay: day, createdAt: now, ...values })
          .returning();
    if (!row) throw new Error('daily close not saved');
    if (notices.kinds.includes('security')) await markSecurityNoticesShown(tx, user.id, now);
    return {
      kind: 'sent',
      closeId: row.id,
      waMessageId: sent.waMessageId,
      format: composition.format,
    };
  });

  logger.info(
    {
      userId: user.id,
      businessDay: day,
      trigger,
      result: result.kind,
      ...(result.kind === 'sent' ? { format: result.format } : {}),
    },
    'close flow',
  );
  return result;
}
