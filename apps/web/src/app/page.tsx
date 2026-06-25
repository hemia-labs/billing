import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { DashboardSummaryClient } from "./dashboard-summary-client";

export const metadata: Metadata = {
  title: "Resumen operativo",
};

export default function Home() {
  return (
    <div>
      <PageHeading
        description="Revisa pendientes comerciales, estados críticos y accesos rápidos de operación."
        title="Resumen operativo"
      />
      <DashboardSummaryClient />
    </div>
  );
}
