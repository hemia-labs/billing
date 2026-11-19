import type { Metadata } from "next";
import { Suspense } from "react";
import { PaypalIntegrationsClient } from "@/features/billing/integrations/payments/paypal-integrations-client";

export const metadata: Metadata = { title: "PayPal" };

export default function PaypalIntegrationsPage() {
  return <Suspense fallback={<p role="status">Cargando conexiones PayPal…</p>}><PaypalIntegrationsClient /></Suspense>;
}
