import type { Metadata } from "next";
import { Card } from "@/components/zuno/card";
import { PageHeading } from "@/components/page-heading";
import { WebhooksClient } from "./webhooks-client";

export const metadata: Metadata = { title: "Webhooks" };

export default function WebhooksPage() {
  return (
    <div>
      <PageHeading
        description="Revisa los eventos recibidos, consulta su detalle y reintenta los fallos verificados."
        title="Webhooks"
      />
      <Card className="overflow-hidden shadow-sm">
        <WebhooksClient />
      </Card>
    </div>
  );
}
