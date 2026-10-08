import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { ProductNewClient } from "@/features/billing/catalog/product-new-client";

export const metadata: Metadata = {
  title: "Nuevo producto",
};

export default function NewProductPage() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeading
        description="Define el producto y después configura sus planes y add-ons."
        title="Nuevo producto"
      />
      <ProductNewClient />
    </div>
  );
}
