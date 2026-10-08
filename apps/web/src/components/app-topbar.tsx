"use client";

import Link from "next/link";
import Image from "next/image";
import { BrandWordmark } from "@/components/brand-wordmark";
import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { labelFor } from "@/lib/nav";
import { getCatalogPlanOverview, getCatalogProduct } from "@/features/billing/catalog/catalog-api";

const integrationTypeLabels: Record<string, string> = {
  oauth: "Clientes OAuth",
  legal: "Hemia Legal",
  payments: "Proveedores de pago",
  events: "Eventos y webhooks",
};

export function AppTopbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isNewProduct = pathname === "/products/new";
  const isNewPlan = pathname === "/products/plans/new";
  const isNewAddon = pathname === "/products/addons/new";
  const isNewIntegrationClient = pathname === "/integrations/clients/new";
  const isNewIntegration = pathname === "/integrations/new";
  const integrationType = /^\/integrations\/([^/]+)$/.exec(pathname)?.[1];
  const isEditIntegrationClient = /^\/integrations\/clients\/[^/]+\/edit$/.test(pathname);
  const integrationClientSegment = /^\/integrations\/clients\/([^/]+)$/.exec(pathname)?.[1];
  const integrationClientId = integrationClientSegment && integrationClientSegment !== "new"
    ? decodeURIComponent(integrationClientSegment)
    : null;
  const isIntegrationRoute = pathname === "/integrations" || pathname.startsWith("/integrations/");
  const newCatalogProductId = isNewPlan || isNewAddon ? searchParams.get("product_id") : null;
  const productId = /^\/products\/([^/]+)$/.exec(pathname)?.[1];
  const planId = /^\/products\/plans\/([^/]+)$/.exec(pathname)?.[1];
  const isPlanDetail = Boolean(planId && planId !== "new");
  const isProductDetail = Boolean(productId && productId !== "new");
  const breadcrumbProductId = isProductDetail ? productId : newCatalogProductId;
  const [productCrumb, setProductCrumb] = useState<{ id: string; code: string; name: string } | null>(null);
  const [planCrumb, setPlanCrumb] = useState<{ id: string; code: string; productId: string; productLabel: string } | null>(null);

  useEffect(() => {
    if (!breadcrumbProductId) return;
    let active = true;
    void getCatalogProduct(breadcrumbProductId)
      .then((product) => {
        if (active) setProductCrumb({ id: breadcrumbProductId, code: product.code, name: product.name });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [breadcrumbProductId]);

  useEffect(() => {
    if (!isPlanDetail || !planId) return;
    let active = true;
    void getCatalogPlanOverview(planId)
      .then((plan) => {
        if (active) setPlanCrumb({
          id: planId,
          code: plan.code,
          productId: plan.productId,
          productLabel: plan.product?.name ?? plan.productCode ?? "Producto",
        });
      })
      .catch(() => {});
    return () => { active = false; };
  }, [isPlanDetail, planId]);

  const currentPlanCrumb = planCrumb?.id === planId ? planCrumb : null;
  const title = labelFor(pathname);

  return (
    <header className="flex h-topbar shrink-0 items-center gap-2 border-b border-border px-4">
      <SidebarTrigger aria-label="Mostrar u ocultar navegación" className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 hidden h-4 md:block" />
      <Link href="/" aria-label="Hemia Billing" className={isIntegrationRoute ? "hidden" : "flex items-center gap-2 md:hidden"}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--hemia-navy)] p-0.5 dark:bg-transparent dark:p-0">
          <Image src="/logo.png" alt="" width={96} height={66} className="h-auto w-full" />
        </span>
        <BrandWordmark compact />
      </Link>
      <Breadcrumb aria-label="Ruta actual" className={isIntegrationRoute ? "min-w-0 flex-1 md:block" : "hidden md:block"}>
        <BreadcrumbList className={isIntegrationRoute ? "min-w-0 flex-nowrap gap-0" : undefined}>
          <BreadcrumbItem className={isIntegrationRoute ? "shrink-0" : undefined}>
            <BreadcrumbLink render={<Link href="/" />}>
              {isIntegrationRoute ? (
                <>
                  <span className="md:hidden">Billing</span>
                  <span className="hidden md:inline">Hemia Billing</span>
                </>
              ) : "Hemia Billing"}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {isIntegrationRoute ? isNewIntegrationClient || isEditIntegrationClient || integrationClientId ? (
            <>
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbLink render={<Link href="/integrations" />}>Integraciones</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbLink render={<Link href="/integrations/oauth" />}>Clientes OAuth</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbPage className="block max-w-[24vw] truncate">
                  {integrationClientId ? integrationClientId : isNewIntegrationClient ? (
                    <>
                      <span className="md:hidden">Nuevo cliente</span>
                      <span className="hidden md:inline">Nuevo cliente autorizado</span>
                    </>
                  ) : (
                    <>
                      <span className="md:hidden">Editar cliente</span>
                      <span className="hidden md:inline">Editar cliente autorizado</span>
                    </>
                  )}
                </BreadcrumbPage>
              </BreadcrumbItem>
            </>
          ) : isNewIntegration ? (
            <>
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbLink render={<Link href="/integrations" />}>Integraciones</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem><BreadcrumbPage>Nueva integración</BreadcrumbPage></BreadcrumbItem>
            </>
          ) : integrationType && integrationTypeLabels[integrationType] ? (
            <>
              <BreadcrumbItem className="min-w-0">
                <BreadcrumbLink render={<Link href="/integrations" />}>Integraciones</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem className="min-w-0"><BreadcrumbPage>{integrationTypeLabels[integrationType]}</BreadcrumbPage></BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>Integraciones</BreadcrumbPage>
            </BreadcrumbItem>
          ) : isNewProduct || isProductDetail || isPlanDetail || isNewPlan || isNewAddon ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/products" />}>Productos</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {isNewProduct ? (
                <BreadcrumbItem><BreadcrumbPage>Nuevo producto</BreadcrumbPage></BreadcrumbItem>
              ) : isNewPlan || isNewAddon ? (
                <>
                  {newCatalogProductId ? (
                    <>
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbLink render={<Link href={`/products/${newCatalogProductId}?tab=${isNewAddon ? "addons" : "plans"}`} />}>
                          {productCrumb?.id === newCatalogProductId ? productCrumb.name : "Producto"}
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  ) : null}
                  <BreadcrumbItem><BreadcrumbPage>{isNewAddon ? "Nuevo add-on" : "Nuevo plan"}</BreadcrumbPage></BreadcrumbItem>
                </>
              ) : isPlanDetail ? (
                <>
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbLink render={<Link href={currentPlanCrumb ? "/products/" + currentPlanCrumb.productId + "?tab=plans" : "/products"} />}>
                      {currentPlanCrumb?.productLabel ?? "Producto"}
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem className="min-w-0">
                    <BreadcrumbPage className="max-w-[30vw] truncate">{currentPlanCrumb?.code ?? "Plan"}</BreadcrumbPage>
                  </BreadcrumbItem>
                </>
              ) : (
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="max-w-[40vw] truncate">{productCrumb?.id === productId ? productCrumb?.code : "Producto"}</BreadcrumbPage>
                </BreadcrumbItem>
              )}
            </>
          ) : (
            <BreadcrumbItem>
              <BreadcrumbPage>{title}</BreadcrumbPage>
            </BreadcrumbItem>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}
