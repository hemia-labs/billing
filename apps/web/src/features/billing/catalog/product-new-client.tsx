"use client";

import { useRouter } from "next/navigation";
import { hasPermission, useSession } from "@/components/auth-gate";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { CopilotLauncher, useProductDraft } from "@/features/billing/copilot";
import { createCatalogProduct, type CatalogProductPayload } from "./catalog-api";
import { ProductForm } from "./product-form";

export function ProductNewClient() {
  const router = useRouter();
  const session = useSession();
  const { draft, currentProduct, setCurrentProduct, clear } = useProductDraft();
  const canManage = hasPermission(session, "billing.catalog.manage");

  const create = async (payload: CatalogProductPayload) => {
    try {
      const product = await createCatalogProduct(payload);
      await clear();
      router.push(`/products/${product.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      throw new Error(apiErrorMessage(error, "No se pudo crear el producto."));
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para administrar productos.
      </div>
    );
  }

  return <ProductForm initialProduct={currentProduct ?? draft?.product} key={draft?.id ?? "empty"} onChange={setCurrentProduct} renderAssistAction={(state) => <CopilotLauncher {...state} />} onSubmit={create} submitLabel="Crear producto" />;
}
