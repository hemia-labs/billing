import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { ProductNewClient } from "@/features/billing/catalog/product-new-client";

export const metadata: Metadata = {
  title: "Nuevo producto",
};

export default function NewProductPage() {
  return (
    <div>
      <PageHeading
        description="Crea una definición comercial de producto para Billing Core."
        title="Nuevo producto"
      />
      <ProductNewClient />
    </div>
  );
}
