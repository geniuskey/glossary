export const REVIEW_QUEUE_FILTERS = ["all", "attention", "active", "ready", "failed"] as const;

export type ReviewQueueFilter = (typeof REVIEW_QUEUE_FILTERS)[number];

export const REVIEW_QUEUE_FILTER_LABEL: Record<ReviewQueueFilter, string> = {
  all: "전체 작업",
  attention: "조치 필요",
  active: "진행 중",
  ready: "검토 필요",
  failed: "실패",
};

export function isReviewQueueFilter(value: string | null | undefined): value is ReviewQueueFilter {
  return value !== null && value !== undefined && (REVIEW_QUEUE_FILTERS as readonly string[]).includes(value);
}
