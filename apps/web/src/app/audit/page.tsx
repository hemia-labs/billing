import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { AuditClient } from "./audit-client";

export const metadata: Metadata = { title: "Auditoría" };

export default function AuditPage() {
  return (
    <div>
      <PageHeading
        description="Consulta la auditoría comercial con metadata saneada y referencias operativas."
        title="Auditoría"
      />
      <AuditClient />
    </div>
  );
}
