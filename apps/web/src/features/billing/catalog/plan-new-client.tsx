"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogPlanPayload,
  type CatalogProduct,
  createCatalogPlan,
  getCatalogProduct,
  listCatalogProducts,
} from "./catalog-api";
import { PlanForm } from "./plan-form";

const productRequests = new Map<string, Promise<CatalogProduct>>();

export function PlanNewClient() {
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

    void Promise.resolve().then(async () => {
      try {
        if (productId) {
          setLockedProduct(await getProduct(productId));
        } else {
          setProducts((await listCatalogProducts({ limit: 100 })).items);
        }
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
  }, [canManage, productId]);

  const create = async (payload: CatalogPlanPayload) => {
    try {
      await createCatalogPlan(payload);
      router.push(`/products/${payload.productId}?tab=plans`);
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
      <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para administrar planes.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando producto...</div>;
  }

  if (message) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message}</div>;
  }

  return (
    <>
      <PageHeading
        breadcrumbItems={[
          { href: "/", label: "Hemia" },
          { href: "/products", label: "Productos" },
          ...(lockedProduct ? [{ href: `/products/${lockedProduct.id}?tab=plans`, label: lockedProduct.name }] : []),
          { label: "Nuevo plan" },
        ]}
        description={lockedProduct ? "Crea una definición comercial de plan para este producto." : "Crea una definición comercial de plan para un producto."}
        title="Nuevo plan"
        titlePrefix={
          <Button aria-label="Volver a producto" className="size-12 shrink-0 rounded-lg" render={<Link href={lockedProduct ? `/products/${lockedProduct.id}?tab=plans` : "/products"} />} size="icon" variant="outline">
            <ArrowLeft className="size-5" />
          </Button>
        }
      />
      <PlanForm defaultProductId={productId} lockedProduct={lockedProduct} onSubmit={create} products={products} submitLabel="Crear plan" />
    </>
  );
}

function getProduct(id: string) {
  const request = productRequests.get(id) ?? getCatalogProduct(id).finally(() => productRequests.delete(id));
  productRequests.set(id, request);
  return request;
}
