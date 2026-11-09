/**
 * Shapes of the web API (`server/src/http/routes/app/**`, spec 10.4). Mirrored by hand: the web
 * does not import server code. Keep in sync with `ledger/queries.ts`, `account/*.ts`,
 * `auth` routes and `counterparty-rules.ts`.
 */

export type IsoDate = string;
export type Direction = 'in' | 'out';
export type PaymentMethod = 'yape' | 'plin' | 'cash' | 'bank_transfer' | 'unknown';
export type Category =
  | 'sale'
  | 'other_income'
  | 'inventory'
  | 'expense'
  | 'household'
  | 'unclassified'
  | 'internal'
  | 'personal';
export type Label = 'screenshot' | 'self_reported' | 'unitemized';
export type EntryStatus = 'confirmed' | 'pending' | 'duplicate' | 'voided' | 'superseded';
export type CloseLevel = 'complete' | 'partial' | 'no_close';
export type EntrySource =
  | 'screenshot'
  | 'activity_list'
  | 'text'
  | 'audio'
  | 'close_reply'
  | 'web'
  | 'chat';

export interface SessionResponse {
  authenticated: boolean;
  pinFresh: boolean;
  pinValidUntil: string | null;
}

export interface EntryView {
  id: string;
  businessDay: IsoDate;
  time: string | null;
  amountCents: number;
  direction: Direction;
  directionText: string;
  paymentMethod: PaymentMethod;
  paymentMethodText: string;
  category: Category;
  categoryText: string;
  counterparty: string | null;
  label: Label;
  labelText: string;
  status: EntryStatus;
  isPending: boolean;
  countsInTotals: boolean;
  afterClose: boolean;
  tags: string[];
}

export interface DayView {
  businessDay: IsoDate;
  label: string;
  isToday: boolean;
  hasActivity: boolean;
  entryCount: number;
  pendingCount: number;
  inCents: number;
  outCents: number;
  leftCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  pendingCents: number;
  level: CloseLevel | null;
  levelText: string | null;
  closeStatus: string | null;
  cashUnreviewed: boolean;
  tags: string[];
}

export interface WeekDay {
  businessDay: IsoDate;
  weekday: string;
  inCents: number;
  outCents: number;
  leftCents: number;
  level: CloseLevel | null;
  levelText: string | null;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeekView {
  weekStart: IsoDate;
  weekEnd: IsoDate;
  label: string;
  inCents: number;
  outCents: number;
  leftCents: number;
  digitalSalesCents: number;
  cashSalesCents: number;
  pendingCents: number;
  completeCount: number;
  partialCount: number;
  noCloseCount: number;
  pointsEarned: number;
  days: WeekDay[];
}

export interface PointsSummary {
  balance: number;
  milestones: number[];
  reached: number[];
  nextMilestone: number | null;
  missingForNextMilestone: number;
  bigGoal: number;
  missingForBigGoal: number;
  nextReward: { id: string; name: string; costPoints: number; missingPoints: number } | null;
  streakDays: number;
  freezesLeft: number;
}

export interface PendingSummary {
  count: number;
  notice: string | null;
}

export interface HomeResponse {
  greeting: { firstName: string | null; businessName: string | null };
  points: PointsSummary;
  week: WeekView;
  pending: PendingSummary;
}

export interface DaysResponse {
  from: IsoDate;
  to: IsoDate;
  label: string | null;
  days: DayView[];
}

export interface DayEntriesResponse {
  day: DayView;
  entries: EntryView[];
  canAddEntries: boolean;
}

export interface EntryHistory {
  versions: (EntryView & { createdAt: string; source: EntrySource })[];
  events: { entryId: string; event: string; actor: string; at: string; detail: unknown }[];
}

export interface PendingOption {
  label: string;
  resolution: { action: string } & Record<string, unknown>;
  input?: 'amount' | 'day';
}

export interface PendingItem {
  id: string;
  type: string;
  businessDay: IsoDate;
  dayLabel: string;
  question: string;
  hint: string | null;
  options: PendingOption[];
  entry: EntryView | null;
}

export interface PendingResponse extends PendingSummary {
  items: PendingItem[];
}

export interface ResolveResponse {
  outcome: string;
  entry: EntryView | null;
  pending: PendingSummary;
}

export interface RewardItem {
  id: string;
  name: string;
  costPoints: number;
  isExample: boolean;
  canRedeem: boolean;
  missingPoints: number;
}

export interface RedemptionItem {
  id: string;
  rewardName: string;
  points: number;
  status: 'delivered' | 'in_review' | 'rejected';
  statusText: string;
  code: string | null;
  createdAt: string;
}

export interface RewardsView {
  balance: number;
  milestones: { points: number; reached: boolean; rewards: RewardItem[] }[];
  bigGoal: {
    rewards: RewardItem[];
    costPoints: number;
    missingPoints: number;
    activeWeeks: number;
    requiredActiveWeeks: number;
    missingWeeks: number;
  };
  redemptions: RedemptionItem[];
}

export interface RedeemResponse {
  redemption: RedemptionItem;
  balance: number;
  message: string;
}

export interface SettingsView {
  businessName: string | null;
  accountHolderName: string | null;
  closeTime: string | null;
  summaryImage: boolean;
  additionalHolders: { id: string; name: string }[];
  maxAdditionalHolders: number;
}

export interface PersonalRuleOffer {
  counterpartyKey: string;
  counterparty: string;
  personalMarks: number;
  question: string;
  hint: string;
}

export interface CounterpartyRulesResponse {
  offers: PersonalRuleOffer[];
  rules: { counterpartyKey: string; counterparty: string; since: string }[];
  offerMarks: number;
}

/** `{ status: 'ok', message }` answers. */
export interface MessageResponse {
  status: string;
  message?: string;
}

// Chat (`server/src/chat`, `routes/app/chat.ts`) ---------------------------------------------

export type ProposalType =
  | 'correct_amount'
  | 'change_category'
  | 'void_entry'
  | 'add_past_entry'
  | 'resolve_clarification';
export type ProposalStatus = 'proposed' | 'confirmed' | 'rejected' | 'expired';

/** A record as the proposal card shows it (12.2 Chat). */
export interface ProposalEntryCard {
  businessDay: IsoDate;
  dayLabel: string;
  time: string | null;
  direction: Direction;
  directionText: string;
  paymentMethod: PaymentMethod;
  methodText: string;
  counterparty: string | null;
  amountCents: number;
  category: Category;
  categoryText: string;
  labelText: string;
  countsInTotals: boolean;
}

export interface ProposalView {
  id: string;
  type: ProposalType;
  status: ProposalStatus;
  createdAt: string;
  intro: string;
  before: ProposalEntryCard | null;
  question: string | null;
  after: { entry: ProposalEntryCard | null; text: string };
  resultText: string | null;
}

export interface ChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  proposal: ProposalView | null;
}

export interface ChatLimit {
  used: number;
  max: number;
  remaining: number;
  reached: boolean;
}

export interface ChatHistoryResponse {
  messages: ChatMessageView[];
  limit: ChatLimit;
  suggestions: string[];
}

export interface ChatSendResponse {
  reply: string;
  proposedAction: ProposalView | null;
  /** Her message and the reply, as stored. */
  messages: [ChatMessageView, ChatMessageView];
  limit: ChatLimit;
}

export interface ChatAnswerResponse {
  proposal: ProposalView;
  reply: ChatMessageView;
}
