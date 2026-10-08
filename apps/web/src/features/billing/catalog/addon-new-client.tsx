"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Alert } from "@/components/zuno/alert";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogAddonPayload,
  type CatalogProduct,
  createCatalogAddon,
  getCatalogProduct,
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
  const [lockedProduct, setLockedProduct] = useState<CatalogProduct | undefined>();
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canManage) return;

    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setMessage("");
      setLockedProduct(undefined);
      setProducts([]);
      try {
        if (productId) {
          const product = await getCatalogProduct(productId);
          if (active) setLockedProduct(product);
        } else {
          const page = await listCatalogProducts({ limit: 100 });
          if (active) setProducts(page.items);
        }
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudieron cargar los productos."));
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [canManage, productId]);

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
    return <Alert variant="destructive">No tienes permiso para administrar add-ons.</Alert>;
  }

  if (loading || (productId && lockedProduct?.id !== productId && !message)) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground">{productId ? "Cargando producto..." : "Cargando productos..."}</div>;
  }

  if (message) {
    return <Alert variant="destructive">{message}</Alert>;
  }

  return <AddonForm defaultProductId={productId} key={productId ?? "choose"} lockedProduct={lockedProduct} onSubmit={create} products={products} submitLabel="Crear add-on" />;
}
