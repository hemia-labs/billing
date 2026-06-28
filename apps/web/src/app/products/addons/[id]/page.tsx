import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { AddonDetailClient } from "@/features/billing/catalog/addon-detail-client";

export const metadata: Metadata = {
  title: "Add-on",
};

export default async function AddonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <PageHeading
        description="Consulta y edita la definición comercial del add-on."
        title="Add-on"
      />
      <AddonDetailClient id={id} />
    </div>
  );
}
