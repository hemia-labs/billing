"use client";

import Link from "next/link";
import Image from "next/image";
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
import { getCatalogPlan, getCatalogProduct } from "@/features/billing/catalog/catalog-api";

export function AppTopbar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isNewPlan = pathname === "/products/plans/new";
  const newPlanProductId = isNewPlan ? searchParams.get("product_id") : null;
  const productId = /^\/products\/([^/]+)$/.exec(pathname)?.[1];
  const planId = /^\/products\/plans\/([^/]+)$/.exec(pathname)?.[1];
  const isPlanDetail = Boolean(planId && planId !== "new");
  const isProductDetail = Boolean(productId && productId !== "new");
  const breadcrumbProductId = isProductDetail ? productId : newPlanProductId;
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
    void getCatalogPlan(planId)
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
      <Link href="/" aria-label="Hemia Billing" className="flex items-center gap-2 md:hidden">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--hemia-navy)] dark:bg-transparent">
          <Image src="/logo.png" alt="" width={96} height={66} className="h-auto w-8" />
        </span>
        <Image src="/wordmark.png" alt="" width={318} height={49} className="h-auto w-36 brightness-0 dark:invert" />
      </Link>
      <Breadcrumb aria-label="Ruta actual" className="hidden md:block">
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link href="/" />}>Hemia Billing</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          {isProductDetail || isPlanDetail || isNewPlan ? (
            <>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href="/products" />}>Productos</BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              {isNewPlan ? (
                <>
                  {newPlanProductId ? (
                    <>
                      <BreadcrumbItem className="min-w-0">
                        <BreadcrumbLink render={<Link href={`/products/${newPlanProductId}?tab=plans`} />}>
                          {productCrumb?.id === newPlanProductId ? productCrumb.name : "Producto"}
                        </BreadcrumbLink>
                      </BreadcrumbItem>
                      <BreadcrumbSeparator />
                    </>
                  ) : null}
                  <BreadcrumbItem><BreadcrumbPage>Nuevo plan</BreadcrumbPage></BreadcrumbItem>
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
