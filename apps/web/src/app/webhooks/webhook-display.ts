export type ProcessingStatus = "pending" | "processing" | "processed" | "failed" | "ignored";
export type WebhookEvent = {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  resourceId: string | null;
  verificationStatus: "verified" | "failed";
  processingStatus: ProcessingStatus;
  errorMessage: string | null;
  attempts: number;
  nextRetryAt: string | null;
  lockedUntil: string | null;
  requiresManualReview: boolean;
  receivedAt: string;
  processedAt: string | null;
};
export type WebhookDetail = WebhookEvent & {
  transmissionId: string | null;
  references: Record<string, string>;
  summary: Record<string, string>;
};
export const processingLabels: Record<ProcessingStatus, string> = {
  pending: "Pendiente", processing: "En proceso", processed: "Procesado", failed: "Fallido", ignored: "Ignorado",
};
export const statusTone = {
  pending: "warning", processing: "info", processed: "success", failed: "error", ignored: "neutral",
} as const;
export function formatDate(value: string | null) {
  if (!value) return "Sin registro";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export type WebhookManualRetry = {
  id: string;
  actorUserId: string | null;
  reason: string | null;
  attempt: number | null;
  createdAt: string;
};
export type WebhookManualRetryPage = {
  items: WebhookManualRetry[];
  total: number;
  page: number;
  limit: number;
};
