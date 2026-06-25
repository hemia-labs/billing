import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { WebhooksClient } from "./webhooks-client";

export const metadata: Metadata = { title: "Webhooks" };

export default function WebhooksPage() {
  return (
    <div>
      <PageHeading
        description="Diagnostica eventos de proveedor y reintenta fallos verificados sin exponer payloads crudos."
        title="Webhooks"
      />
      <WebhooksClient />
    </div>
  );
}
