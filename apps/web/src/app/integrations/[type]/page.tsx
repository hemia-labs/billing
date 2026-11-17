import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { PaymentIntegrationsClient } from "@/features/billing/integrations/payments/payment-integrations-client";
import { legacyPaymentIntegrationHref } from "@/features/billing/integrations/payments/payment-products";
import { IntegrationTypeClient } from "@/features/billing/integrations/catalog/integration-type-client";

export const metadata: Metadata = { title: "Integración" };

const availableTypes = ["legal", "payments", "events"] as const;

export default async function IntegrationTypePage({ params, searchParams }: { params: Promise<{ type: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { type } = await params;
  const selectedType = availableTypes.find((item) => item === type);
  if (!selectedType) notFound();
  if (selectedType === "payments") {
    const destination = legacyPaymentIntegrationHref(await searchParams);
    if (destination) redirect(destination);
  }
  return selectedType === "payments" ? <PaymentIntegrationsClient /> : <IntegrationTypeClient type={selectedType} />;
}
