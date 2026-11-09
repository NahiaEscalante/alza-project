/** Shapes of `/api/admin/*` (server/src/admin). Ids, counts and masked phones only. */

export interface AdminIdentity {
  id: string;
  username: string;
  name: string;
}

export interface SessionResponse {
  authenticated: boolean;
  admin?: AdminIdentity;
}

export interface FailedMessage {
  id: string;
  type: 'image' | 'audio' | 'text' | 'interactive';
  status: 'failed' | 'error';
  errorCode: string | null;
  attempts: number;
  receivedAt: string;
  userId: string;
  phone: string;
}

export interface ErrorsResponse {
  items: FailedMessage[];
  counts: { failed: number; error: number };
  retryAvailable: boolean;
}

export interface RedemptionReview {
  id: string;
  userId: string;
  phone: string;
  rewardName: string;
  points: number;
  status: 'delivered' | 'in_review' | 'rejected';
  createdAt: string;
  activeWeeks: number;
  requiredActiveWeeks: number;
  openAlerts: number;
  reviewedBy: { username: string; name: string } | null;
}

export interface RedemptionsResponse {
  inReview: RedemptionReview[];
  reviewed: RedemptionReview[];
}

export interface AlertItem {
  id: string;
  type: string;
  status: string;
  createdAt: string;
  userId: string | null;
  phone: string | null;
  detail: Record<string, string | number | boolean | string[]>;
  withholdsPoints: boolean;
}

export interface AlertsResponse {
  items: AlertItem[];
  openCount: number;
}

export interface Ratio {
  numerator: number;
  denominator: number;
  rate: number | null;
}

export interface MetricsResponse {
  generatedAt: string;
  today: string;
  windows: { closesDays: number; recentDays: number; weeks: number };
  activation: { onboardingComplete: Ratio; pinCreated: Ratio };
  habit: {
    closesReplied: Ratio;
    completeClosesPerWeek: {
      weekStart: string;
      completeCloses: number;
      activeUsers: number;
      average: number | null;
    }[];
    averageStreakDays: number | null;
    usersWithStreak: number;
  };
  quality: { withoutClarification: Ratio; unreadable: Ratio };
  cost: {
    outbound: number;
    activeUserDays: number;
    perUserPerDay: number | null;
    byType: { type: string; count: number }[];
  };
  web: { weeklyUse: Ratio };
  rewardsAndReports: {
    redemptions: { delivered: number; in_review: number; rejected: number };
    reports: number;
  };
  impact: { consistentRecording: number; historyReady: number };
  waitlist: { signups: number };
}

export interface AuditItem {
  id: string;
  at: string;
  admin: AdminIdentity;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: unknown;
}

export interface ToolsResponse {
  today: string;
  lastFinalizableDay: string;
  technicalIssue: boolean;
}

export interface ToolRunResponse {
  ok: true;
  summary: Record<string, number | string>;
  ranAt: string;
}
