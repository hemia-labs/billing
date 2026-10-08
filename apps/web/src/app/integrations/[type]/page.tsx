import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IntegrationTypeClient } from "@/features/billing/integrations/integration-type-client";

export const metadata: Metadata = { title: "Integración" };

const availableTypes = ["legal", "payments", "events"] as const;

export default async function IntegrationTypePage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const selectedType = availableTypes.find((item) => item === type);
  if (!selectedType) notFound();
  return <IntegrationTypeClient type={selectedType} />;
}
