"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Plus, Search } from "lucide-react";
import { Badge } from "@/components/zuno/badge";
import { StatusBadge } from "@/components/zuno/status-badge";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Button } from "@/components/zuno/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/zuno/dropdown-menu";
import { Input } from "@/components/zuno/input";
import { Label } from "@/components/zuno/label";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@/components/zuno/tabs";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogFilters,
  type CatalogPage,
  type CatalogProduct,
  type CatalogStatus,
  getCatalogProduct,
  listCatalogAddons,
  listCatalogPlans,
} from "../catalog-api";
import { AddonsTable, PlansTable } from "../catalog-client";

type ProductTab = "plans" | "addons";
type StatusFilter = "all" | CatalogStatus;

const pageSize = 10;

export function ProductDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const tab: ProductTab = searchParams.get("tab") === "addons" ? "addons" : "plans";
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [productLoading, setProductLoading] = useState(true);
  const [productError, setProductError] = useState("");
  const [plansSearch, setPlansSearch, plansQuery] = useDebouncedSearch();
  const [addonsSearch, setAddonsSearch, addonsQuery] = useDebouncedSearch();
  const [plansStatus, setPlansStatus] = useState<StatusFilter>("all");
  const [addonsStatus, setAddonsStatus] = useState<StatusFilter>("all");
  const [plansPage, setPlansPage] = useState(1);
  const [addonsPage, setAddonsPage] = useState(1);
  const plans = useCatalogPage(canRead, id, plansQuery, plansStatus, plansPage, listCatalogPlans);
  const addons = useCatalogPage(canRead, id, addonsQuery, addonsStatus, addonsPage, listCatalogAddons);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setProductLoading(true);
      setProductError("");
      try {
        const next = await getCatalogProduct(id);
        if (active) setProduct(next);
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setProductError(apiErrorMessage(error, "No se pudo cargar el producto."));
      } finally {
        if (active) setProductLoading(false);
      }
    });
    return () => { active = false; };
  }, [canRead, id]);

  if (!canRead) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">No tienes permiso para consultar productos.</div>;
  }
  if (productLoading) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Cargando producto...</div>;
  }
  if (!product) {
    return <div className="rounded-xl border border-border bg-card p-5 text-sm text-destructive">{productError || "Producto no encontrado."}</div>;
  }

  const baseHref = "/products/" + id;
  const isPlans = tab === "plans";

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-3xl">{product.name}</h1>
            <StatusBadge status={product.status === "active" ? "success" : "warning"}>
              {product.status === "active" ? "Activo" : "Inactivo"}
            </StatusBadge>
            <Badge variant="outline">{product.code}</Badge>
          </div>
          {product.description ? <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{product.description}</p> : null}
        </div>
        {canManage ? (
          <Button className="w-fit shrink-0" render={<Link href={isPlans ? "/products/plans/new?product_id=" + id : "/products/addons/new?product_id=" + id} />}>
            <Plus className="size-4" />{isPlans ? "Nuevo plan" : "Nuevo add-on"}
          </Button>
        ) : null}
      </header>

      <Tabs
        className="gap-4"
        onValueChange={(value) => {
          if ((value === "plans" || value === "addons") && value !== tab) {
            router.push(value === "plans" ? baseHref : baseHref + "?tab=addons", { scroll: false });
          }
        }}
        value={tab}
        variant="underline"
      >
        <TabsList className="w-full">
          <TabsTab className="min-h-10 px-3" value="plans">Planes <span className="ml-1 text-muted-foreground">({plans.data?.total ?? "—"})</span></TabsTab>
          <TabsTab className="min-h-10 px-3" value="addons">Add-ons <span className="ml-1 text-muted-foreground">({addons.data?.total ?? "—"})</span></TabsTab>
        </TabsList>

        <TabsPanel className="mt-0" value="plans">
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <TableToolbar
              count={plans.data?.total ?? 0}
              loading={plans.loading}
              noun="plan"
              onSearchChange={(value) => { setPlansSearch(value); setPlansPage(1); }}
              onStatusChange={(value) => { setPlansStatus(value); setPlansPage(1); }}
              search={plansSearch}
              searchId="plans-search"
              status={plansStatus}
              statuses={["all", "active", "archived"]}
            />
            {plans.error ? <p className="px-5 pb-4 text-sm text-destructive">{plans.error}</p> : null}
            <div className="overflow-x-auto border-t border-border">
              <PlansTable items={plans.data?.items ?? []} loading={plans.loading} />
            </div>
            <TablePagination
              count={plans.data?.items.length ?? 0}
              loading={plans.loading}
              noun="plan"
              onPageChange={setPlansPage}
              page={plansPage}
              total={plans.data?.total ?? 0}
            />
          </section>
        </TabsPanel>

        <TabsPanel className="mt-0" value="addons">
          <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            <TableToolbar
              count={addons.data?.total ?? 0}
              loading={addons.loading}
              noun="add-on"
              onSearchChange={(value) => { setAddonsSearch(value); setAddonsPage(1); }}
              onStatusChange={(value) => { setAddonsStatus(value); setAddonsPage(1); }}
              search={addonsSearch}
              searchId="addons-search"
              status={addonsStatus}
              statuses={["all", "active", "inactive", "archived"]}
            />
            {addons.error ? <p className="px-5 pb-4 text-sm text-destructive">{addons.error}</p> : null}
            <div className="overflow-x-auto border-t border-border">
              <AddonsTable items={addons.data?.items ?? []} loading={addons.loading} />
            </div>
            <TablePagination
              count={addons.data?.items.length ?? 0}
              loading={addons.loading}
              noun="add-on"
              onPageChange={setAddonsPage}
              page={addonsPage}
              total={addons.data?.total ?? 0}
            />
          </section>
        </TabsPanel>
      </Tabs>
    </div>
  );
}

function useDebouncedSearch(): [string, (value: string) => void, string] {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(draft.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [draft]);
  return [draft, setDraft, query];
}

function useCatalogPage<T>(
  canRead: boolean,
  productId: string,
  search: string,
  status: StatusFilter,
  page: number,
  fetchPage: (filters: CatalogFilters) => Promise<CatalogPage<T>>,
) {
  const [data, setData] = useState<CatalogPage<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    void Promise.resolve().then(async () => {
      if (!active) return;
      setLoading(true);
      setError("");
      try {
        const next = await fetchPage({
          product_id: productId,
          q: search || undefined,
          status: status === "all" ? undefined : status,
          page,
          limit: pageSize,
        });
        if (active) setData(next);
      } catch (cause) {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) {
          redirectToLogin();
          return;
        }
        setData(null);
        setError(apiErrorMessage(cause, "No se pudo cargar la lista."));
      } finally {
        if (active) setLoading(false);
      }
    });
    return () => { active = false; };
  }, [canRead, productId, search, status, page, fetchPage]);

  return { data, loading, error };
}

function TableToolbar({
  count, loading, noun, onSearchChange, onStatusChange, search, searchId, status, statuses,
}: {
  count: number;
  loading: boolean;
  noun: string;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  search: string;
  searchId: string;
  status: StatusFilter;
  statuses: StatusFilter[];
}) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <span aria-live="polite" className="text-sm text-muted-foreground">
        {loading ? "Cargando..." : String(count) + " " + (count === 1 ? noun : noun === "plan" ? "planes" : "add-ons")}
      </span>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:w-72">
          <Label className="sr-only" htmlFor={searchId}>Buscar por código, nombre o proveedor</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-10 text-sm"
            id={searchId}
            maxLength={120}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Buscar"
            value={search}
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="w-full justify-center gap-2 px-4 sm:w-auto" variant="outline" />}>
            <Filter className="size-4" />Filtros{status === "all" ? "" : " (1)"}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuRadioGroup aria-label="Estado" onValueChange={(value) => onStatusChange(value as StatusFilter)} value={status}>
              {statuses.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>{statusLabel(item)}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TablePagination({
  count, loading, noun, onPageChange, page, total,
}: {
  count: number;
  loading: boolean;
  noun: string;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}) {
  const totalPages = Math.ceil(total / pageSize);
  if (totalPages <= 1) return null;
  const first = (page - 1) * pageSize + 1;
  const last = first + count - 1;
  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
      <span>{loading ? "Cargando..." : String(first) + "–" + last + " de " + total + " " + (noun === "plan" ? "planes" : "add-ons")}</span>
      <div className="flex gap-2">
        <Button disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)} size="sm" variant="outline">Anterior</Button>
        <Button disabled={loading || page >= totalPages} onClick={() => onPageChange(page + 1)} size="sm" variant="outline">Siguiente</Button>
      </div>
    </div>
  );
}

function statusLabel(status: StatusFilter) {
  return { all: "Todos los estados", active: "Activo", inactive: "Inactivo", archived: "Archivado" }[status];
}
