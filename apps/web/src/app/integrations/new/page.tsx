import type { Metadata } from "next";
import { IntegrationCatalogClient } from "@/features/billing/integrations/integration-catalog-client";

export const metadata: Metadata = { title: "Nueva integración" };

export default function NewIntegrationPage() {
  return <IntegrationCatalogClient creating />;
}
