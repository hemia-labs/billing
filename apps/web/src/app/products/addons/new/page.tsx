import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { AddonNewClient } from "@/features/billing/catalog/addon-new-client";

export const metadata: Metadata = {
  title: "Nuevo add-on",
};

export default function NewAddonPage() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        description="Crea una definición comercial de add-on para un producto."
        title="Nuevo add-on"
      />
      <AddonNewClient />
    </div>
  );
}
