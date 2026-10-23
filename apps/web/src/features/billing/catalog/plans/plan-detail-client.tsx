"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleMinus, Edit3, X } from "lucide-react";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Alert } from "@/components/zuno/alert";
import { Badge } from "@/components/zuno/badge";
import { StatusBadge } from "@/components/zuno/status-badge";
import { Button } from "@/components/zuno/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/zuno/dialog";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogPlan,
  type CatalogPlanEntitlement,
  type CatalogPlanOverview,
  type CatalogPlanPayload,
  type CatalogPlanPrice,
  type CatalogPlanVersion,
  type CatalogPlanVersionSummary,
  type CatalogPage,
  getCatalogPlan,
  getCatalogPlanOverview,
  getCatalogPlanVersion,
  listCatalogPlanVersionSummaries,
  publishCatalogVersion,
  updateCatalogPlan,
} from "../catalog-api";
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
  const [plan, setPlan] = useState<CatalogPlanOverview | null>(null);
  const [editingPlan, setEditingPlan] = useState<CatalogPlan | null>(null);
  const [editingError, setEditingError] = useState("");
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [versionsRevision, setVersionsRevision] = useState(0);
  const [notice, setNotice] = useState<{ text: string; tone: "success" | "error" } | null>(null);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setNotice(null);
      try {
        const next = await getCatalogPlanOverview(id);
        if (active) setPlan(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setNotice({ text: apiErrorMessage(error, "No se pudo cargar el plan."), tone: "error" });
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [canRead, id]);

  useEffect(() => {
    if (!editing) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setEditingPlan(null);
      setEditingError("");
      try {
        const next = await getPlan(id);
        if (active) setEditingPlan(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setEditingError(apiErrorMessage(error, "No se pudo cargar el editor del plan."));
      }
    });
    return () => { active = false; };
  }, [editing, id]);

  const update = async (payload: CatalogPlanPayload) => {
    try {
      const next = await updateCatalogPlan(id, payload);
      setPlan({ ...next, publishedVersion: plan?.publishedVersion ?? null });
      setEditingPlan(next);
      setVersionsRevision((current) => current + 1);
      setNotice({ text: "Plan guardado.", tone: "success" });
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
    setNotice(null);
    try {
      await publishCatalogVersion(versionId);
      planRequests.delete(id);
      setVersionsRevision((current) => current + 1);
      setNotice({ text: "Versión publicada.", tone: "success" });
      try {
        setPlan(await getCatalogPlanOverview(id));
      } catch {
        setNotice({ text: "Versión publicada, pero no se pudo actualizar el resumen. Recarga la página.", tone: "error" });
      }
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return false;
      }
      setNotice({ text: apiErrorMessage(error, "No se pudo publicar la versión."), tone: "error" });
      return false;
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
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">{notice?.text || "Plan no encontrado."}</div>;
  }

  const planHref = "/products/plans/" + id;
  const productHref = "/products/" + plan.productId + "?tab=plans";
  const productLabel = plan.product?.name ?? plan.productCode ?? "Producto";
  const editingVersion = editingPlan?.versions
    .filter((item) => item.status === "draft")
    .sort((left, right) => right.version - left.version)[0];

  return (
    <div className={editing ? "mx-auto w-full max-w-5xl space-y-5" : "space-y-5"}>
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">{editing ? "Editar " + plan.name : plan.name}</h1>
            <StatusBadge status={plan.status === "active" ? "success" : "neutral"}>{statusLabel(plan.status)}</StatusBadge>
            <Badge variant="outline">{plan.code}</Badge>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Link className="font-medium text-foreground hover:underline" href={productHref}>{productLabel}</Link>
            {plan.publishedVersion ? (
              <>
                <span>{plan.publishedVersion.priceCount} {plan.publishedVersion.priceCount === 1 ? "precio" : "precios"} · {plan.publishedVersion.entitlementCount} {plan.publishedVersion.entitlementCount === 1 ? "característica" : "características"}</span>
                {plan.publishedVersion.effectiveFrom || plan.publishedVersion.effectiveUntil ? (
                  <span>Vigencia: {plan.publishedVersion.effectiveFrom ? formatDate(plan.publishedVersion.effectiveFrom) : "sin inicio"} – {plan.publishedVersion.effectiveUntil ? formatDate(plan.publishedVersion.effectiveUntil) : "sin fin"}</span>
                ) : null}
              </>
            ) : null}
          </div>
          {editing ? (
            <p className="mt-2 text-xs text-muted-foreground">Los cambios en precios o características crean una nueva versión en borrador.</p>
          ) : null}
        </div>
        {!editing && canManage ? (
          <Button className="w-fit shrink-0" render={<Link href={planHref + "?mode=edit"} />}>
            <Edit3 className="size-4" />Editar
          </Button>
        ) : null}
      </header>

      {notice ? (
        <Alert role={notice.tone === "error" ? "alert" : "status"} variant={notice.tone === "error" ? "destructive" : "success"}>
          <span className="min-w-0 flex-1 self-center">{notice.text}</span>
          <Button aria-label="Cerrar aviso" className="-my-1 -mr-2 ml-auto shrink-0 text-current" onClick={() => setNotice(null)} size="icon" type="button" variant="ghost">
            <X aria-hidden="true" className="size-4" />
          </Button>
        </Alert>
      ) : null}

      {editing ? editingPlan?.id === id ? (
        <PlanForm
          cancelHref={planHref}
          initialPlan={editingPlan}
          lockedProduct={plan.product}
          key={editingVersion?.id ?? "new"}
          onSubmit={update}
          products={plan.product ? [plan.product] : []}
          submitLabel="Guardar plan"
        />
      ) : editingError ? (
        <Alert variant="destructive">{editingError}</Alert>
      ) : (
        <div className="rounded-lg border border-border bg-card p-5 text-sm text-muted-foreground">Cargando editor...</div>
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(260px,1fr)]">
          <VersionsPanel canPublish={canPublish} id={id} onPublish={publish} publishing={publishing} revision={versionsRevision} />

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

function VersionsPanel({
  canPublish,
  id,
  onPublish,
  publishing,
  revision,
}: {
  canPublish: boolean;
  id: string;
  onPublish: (versionId: string) => Promise<boolean>;
  publishing: boolean;
  revision: number;
}) {
  const [page, setPage] = useState(1);
  const [versions, setVersions] = useState<CatalogPage<CatalogPlanVersionSummary> | null>(null);
  const [listError, setListError] = useState("");
  const [listRetry, setListRetry] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CatalogPlanVersion | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setVersions(null);
      setListError("");
      try {
        const next = await listCatalogPlanVersionSummaries(id, page);
        if (active) setVersions(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setListError(apiErrorMessage(error, "No se pudieron cargar las versiones."));
      }
    });
    return () => { active = false; };
  }, [id, page, revision, listRetry]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setDetail(null);
      setDetailError("");
      try {
        const next = await getCatalogPlanVersion(id, selectedId);
        if (active) setDetail(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setDetailError(apiErrorMessage(error, "No se pudo cargar el detalle de la versión."));
      }
    });
    return () => { active = false; };
  }, [id, selectedId, revision, detailRetry]);

  const totalPages = versions ? Math.max(1, Math.ceil(versions.total / versions.limit)) : 1;
  const changePage = (next: number) => {
    setSelectedId(null);
    setDetail(null);
    setPage(next);
  };
  const publishVersion = async (versionId: string) => {
    if (await onPublish(versionId)) changePage(1);
  };

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">Versiones y precios</h2>
        {versions ? <span className="text-sm text-muted-foreground">({versions.total})</span> : null}
      </div>
      {listError ? (
        <Alert className="mt-4 items-center justify-between" variant="destructive">
          <span>{listError}</span>
          <Button onClick={() => setListRetry((current) => current + 1)} size="sm" type="button" variant="outline">Reintentar</Button>
        </Alert>
      ) : versions ? versions.items.length ? (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border">
          {versions.items.map((item) => (
            <VersionRow
              canPublish={canPublish}
              detail={selectedId === item.id ? detail : null}
              detailError={selectedId === item.id ? detailError : ""}
              expanded={selectedId === item.id}
              item={item}
              key={item.id}
              onPublish={publishVersion}
              onRetryDetail={() => setDetailRetry((current) => current + 1)}
              onToggle={() => {
                setSelectedId((current) => current === item.id ? null : item.id);
                setDetail(null);
              }}
              publishing={publishing}
            />
          ))}
        </div>
      ) : <p className="mt-4 text-sm text-muted-foreground">Sin versiones configuradas.</p> : (
        <p className="mt-4 text-sm text-muted-foreground">Cargando versiones...</p>
      )}
      {versions && versions.total > versions.limit ? (
        <nav aria-label="Páginas de versiones" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Página {page} de {totalPages}</span>
          <div className="flex gap-2">
            <Button disabled={page <= 1} onClick={() => changePage(page - 1)} size="sm" type="button" variant="outline">Anterior</Button>
            <Button disabled={page >= totalPages} onClick={() => changePage(page + 1)} size="sm" type="button" variant="outline">Siguiente</Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}

function VersionRow({
  canPublish,
  detail,
  detailError,
  expanded,
  item,
  onPublish,
  onRetryDetail,
  onToggle,
  publishing,
}: {
  canPublish: boolean;
  detail: CatalogPlanVersion | null;
  detailError: string;
  expanded: boolean;
  item: CatalogPlanVersionSummary;
  onPublish: (versionId: string) => Promise<void>;
  onRetryDetail: () => void;
  onToggle: () => void;
  publishing: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div>
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">v{item.version}</span>
            <StatusBadge status={item.status === "published" ? "success" : item.status === "draft" ? "info" : "neutral"}>{statusLabel(item.status)}</StatusBadge>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.priceCount} {item.priceCount === 1 ? "precio" : "precios"} · {item.entitlementCount} características · Creada {formatDate(item.createdAt)}
          </p>
          {item.effectiveFrom || item.effectiveUntil ? (
            <p className="mt-1 text-xs text-muted-foreground">Vigencia: {item.effectiveFrom ? formatDate(item.effectiveFrom) : "sin inicio"} – {item.effectiveUntil ? formatDate(item.effectiveUntil) : "sin fin"}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button aria-expanded={expanded} onClick={onToggle} size="sm" type="button" variant="outline">{expanded ? "Ocultar detalle" : "Ver detalle"}</Button>
          {item.status === "draft" && canPublish ? (
            <Button disabled={publishing} onClick={() => setConfirming(true)} size="sm" type="button">Publicar</Button>
          ) : null}
        </div>
      </div>
      {expanded ? (
        <div className="border-t border-border bg-background px-4 py-4">
          {detailError ? (
            <Alert className="items-center justify-between" variant="destructive">
              <span>{detailError}</span>
              <Button onClick={onRetryDetail} size="sm" type="button" variant="outline">Reintentar</Button>
            </Alert>
          ) : detail ? <VersionDetails item={detail} /> : <p className="text-sm text-muted-foreground">Cargando detalle...</p>}
        </div>
      ) : null}
      {item.status === "draft" && canPublish ? (
        <Dialog dismissible={!publishing} onOpenChange={(open) => {
          if (!publishing) setConfirming(open);
        }} open={confirming}>
          <DialogContent showClose={false}>
            <DialogHeader>
              <DialogTitle>¿Publicar la versión v{item.version}?</DialogTitle>
              <DialogDescription>
                Esta versión estará disponible para nuevas suscripciones. La versión publicada actual se archivará, si existe. Las suscripciones existentes conservarán su precio contratado.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button disabled={publishing} onClick={() => setConfirming(false)} type="button" variant="outline">Cancelar</Button>
              <Button loading={publishing} onClick={async () => {
                await onPublish(item.id);
                setConfirming(false);
              }} type="button">Publicar versión</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function VersionDetails({ item }: { item: CatalogPlanVersion }) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Precios ({item.prices.length})</h3>
        {item.prices.length ? (
          <div className="mt-2 divide-y divide-border">
            {item.prices.map((price) => (
              <div className="flex flex-col justify-between gap-2 py-3 sm:flex-row sm:items-start" key={price.id}>
                <div className="min-w-0">
                  <p className="font-medium tabular-nums">{formatPrice(price)}</p>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{price.code}</p>
                </div>
                <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted-foreground sm:justify-end">
                  {price.providerPrices.length ? price.providerPrices.map((provider) => (
                    <span key={provider.id} title={provider.providerPriceId ?? undefined}>
                      {providerLabel(provider.provider)}{provider.providerPriceId ? " · " + provider.providerPriceId : ""}
                    </span>
                  )) : <span>Sin proveedor</span>}
                </div>
              </div>
            ))}
          </div>
        ) : <p className="mt-2 text-sm text-muted-foreground">Sin precios configurados.</p>}
      </section>
      <section>
        <h3 className="text-sm font-semibold">Características ({item.entitlements.length})</h3>
        {item.entitlements.length ? (
          <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
            {item.entitlements.map((entitlement) => (
              <div className="flex min-w-0 items-center justify-between gap-3 border-b border-border py-3" key={entitlement.id}>
                <dt className="flex min-w-0 items-center gap-2 text-sm">
                  {entitlement.valueJson === false
                    ? <CircleMinus aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                    : <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-primary" />}
                  <span className="truncate" title={entitlement.feature.code}>{featureLabel(entitlement)}</span>
                </dt>
                <dd className="max-w-[50%] min-w-0 break-words text-right text-sm font-medium">{formatFeature(entitlement)}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-2 text-sm text-muted-foreground">Sin características configuradas.</p>}
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", { day: "numeric", month: "short", year: "numeric" }).format(new Date(value));
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
