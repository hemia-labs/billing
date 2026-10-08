"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { hasPermission, useSession } from "@/components/auth-gate";
import { PageHeading } from "@/components/page-heading";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogPlanPayload,
  type CatalogProduct,
  createCatalogPlan,
  getCatalogProduct,
  listCatalogProducts,
} from "./catalog-api";
import { PlanForm } from "./plan-form";
import { CopilotLauncher, usePlanDraft } from '../copilot';

export function PlanNewClient() {
  const { draft, currentPlan, setCurrentPlan, clear } = usePlanDraft();
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
      setLoading(true); setMessage(""); setLockedProduct(undefined); setProducts([]);
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

  const create = async (payload: CatalogPlanPayload) => {
    try {
      const plan = await createCatalogPlan(payload);
      await clear();
      router.push(`/products/plans/${plan.id}`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      throw new Error(apiErrorMessage(error, "No se pudo crear el plan."));
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para administrar planes.
      </div>
    );
  }

  if (loading || (productId && lockedProduct?.id !== productId && !message)) {
    return <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando producto...</div>;
  }

  if (message) {
    return <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message}</div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl">
      <PageHeading
        description={lockedProduct
          ? `Para ${lockedProduct.name}. La primera versión se guardará como borrador.`
          : "La primera versión se guardará como borrador."}
        title="Nuevo plan"
      />
      <PlanForm
        renderAssistAction={({ productId, ...state }) => <CopilotLauncher {...state} requiresProduct={!productId} />}
        key={`${productId ?? 'choose'}:${draft?.id ?? 'empty'}`}
        initialDraft={currentPlan ?? draft?.plan}
        onDraftChange={productId ? setCurrentPlan : undefined}
        onProductChange={(id) => router.replace(`/products/plans/new?product_id=${encodeURIComponent(id)}`)}
        cancelHref={lockedProduct ? `/products/${lockedProduct.id}?tab=plans` : "/products"}
        defaultProductId={productId}
        lockedProduct={lockedProduct}
        onSubmit={create}
        products={products}
        submitLabel="Crear borrador"
      />
    </div>
  );
}
