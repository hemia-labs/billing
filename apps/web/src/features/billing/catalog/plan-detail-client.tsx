"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Edit3 } from "lucide-react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Badge } from "@/components/zuno/badge";
import { StatusBadge } from "@/components/zuno/status-badge";
import { Button } from "@/components/zuno/button";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogPlan,
  type CatalogPlanEntitlement,
  type CatalogPlanPayload,
  type CatalogPlanPrice,
  type CatalogPlanVersion,
  getCatalogPlan,
  primaryPrice,
  primaryProviderPrice,
  primaryVersion,
  publishCatalogVersion,
  updateCatalogPlan,
} from "./catalog-api";
import { PlanForm } from "./plan-form";

const planRequests = new Map<string, Promise<CatalogPlan>>();

export function PlanDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const canPublish = hasPermission(session, "billing.catalog.publish");
  const editing = searchParams.get("mode") === "edit" && canManage;
  const [plan, setPlan] = useState<CatalogPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setMessage("");
      try {
        const next = await getPlan(id);
        if (active) setPlan(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudo cargar el plan."));
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [canRead, id]);

  const update = async (payload: CatalogPlanPayload) => {
    try {
      const next = await updateCatalogPlan(id, payload);
      setPlan(next);
      setMessage("Plan guardado.");
      router.replace("/products/plans/" + id);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      throw new Error(apiErrorMessage(error, "No se pudo guardar el plan."));
    }
  };

  const publish = async (versionId: string) => {
    setPublishing(true);
    setMessage("");
    try {
      await publishCatalogVersion(versionId);
      planRequests.delete(id);
      setPlan(await getPlan(id));
      setMessage("Versión publicada.");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudo publicar la versión."));
    } finally {
      setPublishing(false);
    }
  };

  if (!canRead) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">No tienes permiso para consultar planes.</div>;
  }
  if (loading) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Cargando plan...</div>;
  }
  if (!plan) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">{message || "Plan no encontrado."}</div>;
  }

  const planHref = "/products/plans/" + id;
  const productHref = "/products/" + plan.productId + "?tab=plans";
  const productLabel = plan.product?.name ?? plan.productCode ?? "Producto";
  const version = primaryVersion(plan);
  const price = primaryPrice(plan);
  const providerPrice = primaryProviderPrice(plan);
  const features = version?.entitlements ?? [];
  const sortedVersions = [...plan.versions].sort((a, b) => b.version - a.version);
  const visibleVersions = version
    ? [version, ...sortedVersions.filter((item) => item.status === "draft" && item.id !== version.id)]
    : sortedVersions.filter((item) => item.status === "draft");
  const olderVersions = sortedVersions.filter((item) => !visibleVersions.includes(item));
  const editingVersion = sortedVersions.find((item) => item.status === "draft") ?? version;

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">{editing ? "Editar " + plan.name : plan.name}</h1>
            <StatusBadge status={plan.status === "active" ? "success" : "neutral"}>{statusLabel(plan.status)}</StatusBadge>
            <Badge variant="outline">{plan.code}</Badge>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <Link className="text-foreground hover:underline" href={productHref}>{productLabel}</Link>
            <span aria-hidden="true">·</span>
            <span>{price ? formatPrice(price) : "Sin precio principal"}</span>
            <span aria-hidden="true">·</span>
            <span>{providerPrice ? providerLabel(providerPrice.provider) : "Sin proveedor"}</span>
          </p>
        </div>
        {!editing && canManage ? (
          <Button className="w-fit shrink-0" render={<Link href={planHref + "?mode=edit"} />}>
            <Edit3 className="size-4" />Editar
          </Button>
        ) : null}
      </header>

      {message ? <p aria-live="polite" className="rounded-lg border border-border bg-card px-4 py-3 text-sm">{message}</p> : null}

      {editing ? (
        <div className="max-w-6xl">
          <PlanForm
            cancelHref={planHref}
            initialPlan={plan}
            lockedProduct={plan.product}
            key={editingVersion?.id ?? "new"}
            onSubmit={update}
            products={plan.product ? [plan.product] : []}
            submitLabel="Guardar plan"
          />
        </div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <div className="space-y-5">
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Versiones y precios</h2>
                <span className="text-sm text-muted-foreground">({plan.versions.length})</span>
              </div>
              {plan.versions.length ? (
                <div className="mt-4 space-y-3">
                  {visibleVersions.map((item) => (
                    <VersionCard
                      canPublish={canPublish}
                      item={item}
                      key={item.id}
                      onPublish={publish}
                      publishing={publishing}
                    />
                  ))}
                  {olderVersions.length ? (
                    <details className="rounded-lg border border-border">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-medium hover:bg-muted/30">
                        Ver versiones anteriores ({olderVersions.length})
                      </summary>
                      <div className="space-y-3 border-t border-border p-3">
                        {olderVersions.map((item) => (
                          <VersionCard canPublish={false} item={item} key={item.id} onPublish={publish} publishing={publishing} />
                        ))}
                      </div>
                    </details>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Sin versiones configuradas.</p>
              )}
            </section>

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">Características incluidas</h2>
                <span className="text-sm text-muted-foreground">({features.length})</span>
              </div>
              {features.length ? (
                <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
                  {features.map((entitlement) => (
                    <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-3" key={entitlement.id}>
                      <dt className="flex min-w-0 items-center gap-2 text-sm">
                        <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-primary" />
                        <span className="truncate" title={entitlement.feature.code}>{featureLabel(entitlement)}</span>
                      </dt>
                      <dd className="shrink-0 text-sm font-medium">{formatFeature(entitlement)}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">Sin características configuradas.</p>
              )}
            </section>
          </div>

          <aside className="rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Detalles del plan</h2>
            <dl className="mt-3 divide-y divide-border text-sm">
              <div className="py-3">
                <dt className="text-muted-foreground">Producto</dt>
                <dd className="mt-1 font-medium"><Link className="hover:underline" href={productHref}>{productLabel}</Link></dd>
              </div>
              <div className="py-3">
                <dt className="text-muted-foreground">Descripción</dt>
                <dd className="mt-1 font-medium">{plan.description || "Sin descripción"}</dd>
              </div>
              <div className="py-3">
                <dt className="text-muted-foreground">Versión principal</dt>
                <dd className="mt-1 font-medium">{version ? "v" + version.version + " · " + statusLabel(version.status) : "Sin versión"}</dd>
              </div>
              <div className="py-3">
                <dt className="text-muted-foreground">Código del plan</dt>
                <dd className="mt-1 break-all font-mono text-xs">{plan.code}</dd>
              </div>
            </dl>
          </aside>
        </div>
      )}
    </div>
  );
}

function VersionCard({
  canPublish,
  item,
  onPublish,
  publishing,
}: {
  canPublish: boolean;
  item: CatalogPlanVersion;
  onPublish: (versionId: string) => Promise<void>;
  publishing: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <span className="font-semibold">v{item.version}</span>
        <Badge variant={item.status === "published" ? "secondary" : "outline"}>{statusLabel(item.status)}</Badge>
        <span className="text-xs text-muted-foreground">{item.prices.length} {item.prices.length === 1 ? "precio" : "precios"} · {item.entitlements.length} características</span>
        {item.status === "draft" && canPublish ? (
          <Button className="ml-auto" disabled={publishing} onClick={() => void onPublish(item.id)} size="sm" type="button" variant="outline">
            Publicar versión
          </Button>
        ) : null}
      </div>
      {item.prices.length ? (
        <div className="divide-y divide-border border-t border-border">
          {item.prices.map((itemPrice) => (
            <div className="flex flex-col justify-between gap-2 px-4 py-3 sm:flex-row sm:items-start" key={itemPrice.id}>
              <div className="min-w-0">
                <p className="font-medium tabular-nums">{formatPrice(itemPrice)}</p>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{itemPrice.code}</p>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                {itemPrice.providerPrices.length ? itemPrice.providerPrices.map((provider) => (
                  <span key={provider.id} title={provider.providerPriceId ?? undefined}>
                    {providerLabel(provider.provider)}{provider.providerPriceId ? " · " + provider.providerPriceId : ""}
                  </span>
                )) : <span>Sin proveedor</span>}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getPlan(id: string) {
  const request = planRequests.get(id) ?? getCatalogPlan(id).finally(() => planRequests.delete(id));
  planRequests.set(id, request);
  return request;
}

function formatPrice(price: CatalogPlanPrice) {
  const amount = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(price.amount));
  const unit = price.billingInterval === "month" ? "mes" : "año";
  const interval = price.billingIntervalCount === 1 ? " / " + unit : " · cada " + price.billingIntervalCount + " " + (unit === "mes" ? "meses" : "años");
  return price.currency + " " + amount + interval;
}

function providerLabel(value: string) {
  return ({ paypal: "PayPal", stripe: "Stripe", mercado_pago: "Mercado Pago", manual_transfer: "Transferencia" } as Record<string, string>)[value] ?? value;
}

function statusLabel(value: string) {
  return ({ active: "Activo", archived: "Archivado", draft: "Borrador", published: "Publicada" } as Record<string, string>)[value] ?? value;
}

const featureNames: Record<string, string> = {
  "appointments.advanced_management": "Gestión avanzada de citas",
  "branches.included": "Sucursales incluidas",
  "business_admin_audit.enabled": "Auditoría administrativa",
  "businesses.included": "Negocios incluidos",
  "clinic_settings.basic": "Configuración básica de clínica",
  "clinical_history.enabled": "Historial clínico",
  "clinical_record.enabled": "Expediente clínico",
  "clinical_templates.by_professional_or_specialty": "Plantillas por profesional o especialidad",
  "clinical_templates.custom": "Plantillas clínicas personalizadas",
  "consents.basic": "Consentimientos básicos",
  "consents.enabled": "Consentimientos",
  "dashboard.admin": "Panel administrativo",
  "dashboard.basic": "Panel básico",
  "dashboard.operational": "Panel operativo",
  "documents.basic": "Documentos básicos",
  "documents.enabled": "Documentos",
  "onboarding.assisted": "Acompañamiento inicial",
  "patients.unlimited_reasonable_use": "Pacientes ilimitados (uso razonable)",
  "prescriptions.enabled": "Recetas",
  "professionals.included": "Profesionales incluidos",
  "reports.advanced_basic": "Reportes avanzados",
  "reports.basic": "Reportes básicos",
  "roles_permissions.advanced": "Roles y permisos avanzados",
  "schedule.advanced": "Agenda avanzada",
  "schedule.basic": "Agenda básica",
  "schedule.multi_professional": "Agenda multiprofesional",
  "support.priority": "Soporte prioritario",
  "support.standard": "Soporte estándar",
  "users.auxiliary.included": "Usuarios auxiliares",
};

function featureLabel(entitlement: CatalogPlanEntitlement) {
  const feature = entitlement.feature;
  const name = feature.name?.trim() || feature.code;
  return featureNames[feature.code] ?? name.replace(/[._]/g, " ").replace(/\s+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatFeature(entitlement: CatalogPlanEntitlement) {
  const value = entitlement.valueJson;
  if (typeof value === "boolean") return value ? "Incluido" : "No incluido";
  if (typeof value === "number") {
    const units: Record<string, [string, string]> = {
      professionals: ["profesional", "profesionales"],
      users: ["usuario", "usuarios"],
      businesses: ["negocio", "negocios"],
      branches: ["sucursal", "sucursales"],
    };
    const unit = entitlement.feature.unit;
    const label = unit ? units[unit]?.[value === 1 ? 0 : 1] ?? unit : "";
    return new Intl.NumberFormat("es-MX").format(value) + (label ? " " + label : "");
  }
  if (value === null || value === undefined) return "Sin valor";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
