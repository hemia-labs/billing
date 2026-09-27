import type { Metadata } from "next";
import { PageHeading } from "@/components/page-heading";
import { Card } from "@/components/zuno/card";
import { CatalogClient } from "@/features/billing/catalog/catalog-client";
import { ProductCreateAction } from "@/features/billing/catalog/product-create-action";

export const metadata: Metadata = {
  title: "Productos",
};

export default function CatalogPage() {
  return (
    <div>
      <PageHeading
        actions={<ProductCreateAction />}
        description="Administra los productos y sus planes/add-ons comerciales."
        title="Productos"
      />
      <Card className="overflow-hidden shadow-sm">
        <CatalogClient />
      </Card>
    </div>
  );
}
