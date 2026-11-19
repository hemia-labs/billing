"use client";

import { PageHeading } from "@/components/page-heading";
import { hasPermission, useSession } from "@/components/auth-gate";
import { PaymentProviderOverview } from "./payment-provider-overview";

export function PaymentIntegrationsClient() {
  const session = useSession();
  if (!hasPermission(session, "billing.catalog.read")) return <PageHeading title="Proveedores de pago" description="No tienes permiso para consultar conexiones de pago." />;
  return (
    <div className="space-y-5">
      <PageHeading title="Proveedores de pago" description="Conecta un proveedor a tus productos." />
      <PaymentProviderOverview canManage={hasPermission(session, "billing.catalog.manage")} />
    </div>
  );
}
