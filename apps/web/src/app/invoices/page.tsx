import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { InvoicesClient } from "./invoices-client";

export const metadata: Metadata = {
  title: "Facturas",
};

export default function InvoicesPage() {
  return (
    <div>
      <PageHeading
        description="Consulta y opera invoices fiscales desde los datos saneados de Billing Core."
        title="Facturas"
      />
      <InvoicesClient />
    </div>
  );
}
