import type { Metadata } from "next";
import { ProductDetailClient } from "@/features/billing/catalog/products/product-detail-client";

export const metadata: Metadata = {
  title: "Producto",
};

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div>
      <ProductDetailClient id={id} />
    </div>
  );
}
