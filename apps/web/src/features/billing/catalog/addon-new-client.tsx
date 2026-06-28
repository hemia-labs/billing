"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { hasPermission, useSession } from "@/components/auth-gate";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogAddonPayload,
  type CatalogProduct,
  createCatalogAddon,
  listCatalogProducts,
} from "./catalog-api";
import { AddonForm } from "./addon-form";

export function AddonNewClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const productId = searchParams.get("product_id") ?? undefined;
  const session = useSession();
  const canManage = hasPermission(session, "billing.catalog.manage");
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canManage) return;

    void Promise.resolve().then(async () => {
      try {
        setProducts((await listCatalogProducts({ limit: 100 })).items);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudieron cargar los productos."));
      } finally {
        setLoading(false);
      }
    });
  }, [canManage]);

  const create = async (payload: CatalogAddonPayload) => {
    try {
      await createCatalogAddon(payload);
      router.push(`/products/${payload.productId}?tab=addons`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      throw new Error(apiErrorMessage(error, "No se pudo crear el add-on."));
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para administrar add-ons.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando productos...</div>;
  }

  if (message) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message}</div>;
  }

  return <AddonForm defaultProductId={productId} onSubmit={create} products={products} submitLabel="Crear add-on" />;
}
