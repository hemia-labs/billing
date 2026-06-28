"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, CreditCard, Edit3, Sparkles } from "lucide-react";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogPlan,
  type CatalogPlanPayload,
  getCatalogPlan,
  primaryPrice,
  primaryProviderPrice,
  primaryVersion,
  updateCatalogPlan,
} from "./catalog-api";
import { PlanForm } from "./plan-form";

const planRequests = new Map<string, Promise<CatalogPlan>>();

export function PlanDetailClient({ id }: { id: string }) {
  const searchParams = useSearchParams();
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const editing = searchParams.get("mode") === "edit";
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canRead) return;

    void Promise.resolve().then(async () => {
      setLoading(true);
      setMessage("");

      try {
        const nextPlan = await getPlan(id);
        setPlan(nextPlan);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudo cargar el plan."));
      } finally {
        setLoading(false);
      }
    });
  }, [canRead, id]);

  const update = async (payload: CatalogPlanPayload) => {
    try {
      const next = await updateCatalogPlan(id, payload);
      setPlan(next);
      setMessage("Plan guardado.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudo guardar el plan."));
    }
  };

  if (!canRead) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para consultar planes.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando plan...</div>;
  }

  if (!plan) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message || "Plan no encontrado."}</div>;
  }

  const productLabel = plan.product?.name ?? plan.productCode ?? plan.productId;
  const productHref = `/products/${plan.productId}?tab=plans`;
  const products = plan.product ? [plan.product] : [];
  const version = primaryVersion(plan);
  const price = primaryPrice(plan);
  const providerPrice = primaryProviderPrice(plan);
  const features = version?.entitlements ?? [];
  const rows = [
    ["Producto", productLabel],
    ["Código", plan.code],
    ["Versión principal", version ? `v${version.version} · ${label(version.status)}` : "Sin versión"],
    ["Proveedor", providerPrice ? label(providerPrice.provider) : "Sin proveedor"],
    ["Provider price ID", providerPrice?.providerPriceId || "Sin provider price ID"],
    ["Intervalo", price ? label(price.billingInterval) : "Sin intervalo"],
    ["Precio", price ? `${price.currency} ${price.amount}` : "Sin precio"],
    ["Estado", label(plan.status)],
  ];

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <AppBreadcrumb
          items={[
            { href: "/", label: "Hemia" },
            { href: "/products", label: "Productos" },
            { href: productHref, label: productLabel },
            { label: plan.code },
          ]}
          title={plan.name}
        />
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <Button aria-label="Volver a producto" className="mt-1 size-12 shrink-0 rounded-lg" render={<Link href={productHref} />} size="icon-lg" variant="outline">
              <ArrowLeft className="size-5" />
            </Button>
            <span className="mt-1 grid size-12 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
              <CreditCard className="size-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-3xl font-bold tracking-normal md:text-4xl">{plan.name}</h1>
                <Badge className={plan.status === "active" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : undefined} variant="secondary">
                  {label(plan.status)}
                </Badge>
                <Badge className="bg-secondary text-primary" variant="secondary">{plan.code}</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                {price ? `${price.currency} ${price.amount} / ${label(price.billingInterval)}` : "Sin precio principal"} · {providerPrice ? label(providerPrice.provider) : "Sin proveedor"}
              </p>
              <p className="mt-2 text-sm font-semibold text-muted-foreground">
                Producto: <Link className="text-primary hover:underline" href={productHref}>{productLabel}</Link>
              </p>
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-wrap gap-3">
              <Button className="h-12 gap-2 rounded-lg px-4 font-semibold" render={<Link href={`/products/plans/${id}?mode=edit`} />}>
                <Edit3 className="size-5" />Editar
              </Button>
            </div>
          ) : null}
        </div>

        <div className="mt-5 divide-y divide-border rounded-lg border border-border bg-background px-4">
          {rows.map(([name, value]) => (
            <div className="grid gap-2 py-4 md:grid-cols-[14rem_minmax(0,1fr)] md:items-center" key={name}>
              <p className="text-sm font-semibold text-muted-foreground">{name}</p>
              <p className="min-w-0 break-words text-sm font-bold">{value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary text-primary">
            <CreditCard className="size-5" />
          </span>
          <h2 className="text-lg font-bold">Versiones y precios</h2>
          <span className="grid size-7 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">{plan.versions.length}</span>
        </div>

        {plan.versions.length ? (
          <div className="mt-5 space-y-3">
            {[...plan.versions].sort((a, b) => b.version - a.version).map((item) => (
              <div className="rounded-lg border border-border bg-background p-4" key={item.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-bold">v{item.version}</p>
                  <Badge variant={item.status === "published" ? "secondary" : "outline"}>{label(item.status)}</Badge>
                  <span className="text-sm text-muted-foreground">{item.prices.length} precios · {item.entitlements.length} features</span>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {item.prices.map((itemPrice) => (
                    <div className="rounded-md border border-border bg-card p-4" key={itemPrice.id}>
                      <p className="font-mono text-xs font-semibold text-muted-foreground">{itemPrice.code}</p>
                      <p className="mt-2 text-sm font-bold">{itemPrice.currency} {itemPrice.amount} / {label(itemPrice.billingInterval)}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {itemPrice.providerPrices.map((itemProvider) => (
                          <Badge key={itemProvider.id} variant={itemProvider.status === "active" ? "secondary" : "outline"}>
                            {label(itemProvider.provider)} · {itemProvider.providerPriceId || "sin id"}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            Sin versiones configuradas.
          </p>
        )}
      </section>

      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary text-primary">
            <Sparkles className="size-5" />
          </span>
          <h2 className="text-lg font-bold">Features del plan</h2>
          <span className="grid size-7 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">{features.length}</span>
        </div>

        {features.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {features.map((entitlement) => (
              <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-4" key={entitlement.id}>
                <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{label(entitlement.feature.code)}</span>
                </span>
                <span className="shrink-0 text-sm font-bold">{formatFeature(entitlement.valueJson)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-5 rounded-lg border border-border bg-background px-4 py-6 text-center text-sm text-muted-foreground">
            Sin features configurados.
          </p>
        )}
      </section>

      {message ? <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium shadow-sm">{message}</div> : null}
      {editing && canManage ? <PlanForm initialPlan={plan} onSubmit={update} products={products} submitLabel="Guardar plan" /> : null}
    </div>
  );
}

function getPlan(id: string) {
  const request = planRequests.get(id) ?? getCatalogPlan(id).finally(() => planRequests.delete(id));
  planRequests.set(id, request);
  return request;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}

function formatFeature(value: unknown) {
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (value === null || value === undefined) return "Sin valor";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
