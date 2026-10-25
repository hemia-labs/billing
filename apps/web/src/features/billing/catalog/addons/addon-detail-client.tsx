"use client";

import { useEffect, useState } from "react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogAddon,
  type CatalogAddonPayload,
  type CatalogProduct,
  getCatalogAddon,
  listCatalogProducts,
  updateCatalogAddon,
} from "../catalog-api";
import { AddonForm } from "./addon-form";

export function AddonDetailClient({ id }: { id: string }) {
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const [addon, setAddon] = useState<CatalogAddon | null>(null);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canRead) return;

    void Promise.resolve().then(async () => {
      setLoading(true);
      setMessage("");

      try {
        const [nextAddon, nextProducts] = await Promise.all([
          getCatalogAddon(id),
          listCatalogProducts({ limit: 100 }),
        ]);
        setAddon(nextAddon);
        setProducts(nextProducts.items);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudo cargar el add-on."));
      } finally {
        setLoading(false);
      }
    });
  }, [canRead, id]);

  const update = async (payload: CatalogAddonPayload) => {
    try {
      const next = await updateCatalogAddon(id, payload);
      setAddon(next);
      setMessage("Add-on guardado.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudo guardar el add-on."));
    }
  };

  if (!canRead) {
    return (
      <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para consultar add-ons.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando add-on...</div>;
  }

  if (!addon) {
    return <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message || "Add-on no encontrado."}</div>;
  }

  return (
    <div className="space-y-4">
      {message ? <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium shadow-sm">{message}</div> : null}
      {!canManage ? <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Vista de sólo lectura.</div> : null}
      <AddonForm initialAddon={addon} onSubmit={update} products={products} readOnly={!canManage} submitLabel="Guardar add-on" />
    </div>
  );
}
