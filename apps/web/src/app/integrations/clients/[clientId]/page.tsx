import type { Metadata } from "next";
import { ServiceClientDetailClient } from "@/features/billing/integrations/service-clients/service-client-detail-client";

export const metadata: Metadata = { title: "Detalle de integración" };

export default async function AuthorizedClientPage({ params, searchParams }: {
  params: Promise<{ clientId: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ clientId }, { tab }] = await Promise.all([params, searchParams]);
  return <ServiceClientDetailClient key={clientId} clientId={clientId} tab={tab === "organizations" || tab === "return-origins" ? tab : "products"} />;
}
