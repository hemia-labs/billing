import type { Metadata } from "next";
import { WebhookDetailClient } from "./webhook-detail-client";

export const metadata: Metadata = { title: "Detalle de webhook" };

export default async function WebhookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <WebhookDetailClient id={id} />;
}
