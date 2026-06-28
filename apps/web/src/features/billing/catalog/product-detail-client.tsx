"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Boxes, Filter, Layers3, Plus, Puzzle, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AppBreadcrumb } from "@/components/app-breadcrumb";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  type CatalogAddon,
  type CatalogPlan,
  type CatalogProduct,
  getCatalogProduct,
  listCatalogAddons,
  listCatalogPlans,
  primaryPrice,
  primaryProviderPrice,
} from "./catalog-api";
import { AddonsTable, PlansTable } from "./catalog-client";

type ProductTab = "plans" | "addons";
type DetailData = {
  addons: CatalogAddon[];
  plans: CatalogPlan[];
  product: CatalogProduct;
};
type StatusFilter = "all" | "active" | "inactive" | "archived";

const detailRequests = new Map<string, Promise<DetailData>>();
const pageSize = 10;
const statuses: StatusFilter[] = ["all", "active", "inactive", "archived"];

export function ProductDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const tab = getTab(searchParams.get("tab"));
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [plans, setPlans] = useState<CatalogPlan[]>([]);
  const [addons, setAddons] = useState<CatalogAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [plansSearch, setPlansSearch] = useState("");
  const [plansStatus, setPlansStatus] = useState<StatusFilter>("all");
  const [plansPage, setPlansPage] = useState(1);
  const [addonsSearch, setAddonsSearch] = useState("");
  const [addonsStatus, setAddonsStatus] = useState<StatusFilter>("all");
  const [addonsPage, setAddonsPage] = useState(1);

  useEffect(() => {
    if (!canRead) return;

    void Promise.resolve().then(async () => {
      setLoading(true);
      setMessage("");

      try {
        const next = await getProductDetail(id);
        setProduct(next.product);
        setPlans(next.plans);
        setAddons(next.addons);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudo cargar el producto."));
      } finally {
        setLoading(false);
      }
    });
  }, [canRead, id]);

  if (!canRead) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para consultar productos.
      </div>
    );
  }

  if (loading) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Cargando producto...</div>;
  }

  if (!product) {
    return <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">{message || "Producto no encontrado."}</div>;
  }

  const filteredPlans = filterPlans(plans, plansSearch, plansStatus);
  const filteredAddons = filterAddons(addons, addonsSearch, addonsStatus);
  const plansPageData = paginate(filteredPlans, plansPage);
  const addonsPageData = paginate(filteredAddons, addonsPage);
  const baseHref = `/products/${id}`;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <AppBreadcrumb
          items={[
            { href: "/", label: "Hemia" },
            { href: "/products", label: "Productos" },
            { label: product.code },
          ]}
          title={product.name}
        />
        <div className="flex flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div className="flex min-w-0 items-start gap-4">
            <Button aria-label="Volver a productos" className="mt-1 size-12 shrink-0 rounded-lg" render={<Link href="/products" />} size="icon-lg" variant="outline">
              <ArrowLeft className="size-5" />
            </Button>
            <span className="mt-1 grid size-12 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
              <Boxes className="size-6" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="truncate text-3xl font-bold tracking-normal md:text-4xl">{product.name}</h1>
                <Badge className={product.status === "active" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : undefined} variant="secondary">
                  {label(product.status)}
                </Badge>
                <Badge className="bg-secondary text-primary" variant="secondary">{product.code}</Badge>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">{product.description || "Sin descripción"}</p>
            </div>
          </div>

          {canManage ? (
            <div className="flex flex-wrap gap-3">
              <Button className="h-12 gap-2 rounded-lg px-4 font-semibold" render={<Link href={`/products/plans/new?product_id=${id}`} />}>
                <Plus className="size-5" />Nuevo plan
              </Button>
              <Button className="h-12 gap-2 rounded-lg px-4 font-semibold" render={<Link href={`/products/addons/new?product_id=${id}`} />} variant="outline">
                <Plus className="size-5" />Nuevo add-on
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {message ? <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm font-medium shadow-sm">{message}</div> : null}
      {!canManage ? <div className="rounded-lg border border-border bg-card px-5 py-4 text-sm text-muted-foreground shadow-sm">Vista de sólo lectura.</div> : null}

      <Tabs
        className="gap-5"
        onValueChange={(value) => {
          if ((value === "plans" || value === "addons") && value !== tab) router.push(value === "plans" ? baseHref : `${baseHref}?tab=${value}`, { scroll: false });
        }}
        value={tab}
      >
        <div className="w-full overflow-x-auto rounded-lg border border-border bg-card px-2 py-3 shadow-sm">
          <TabsList className="h-auto w-max justify-start gap-2 bg-card p-0" variant="line">
            {tabs.map((item) => (
              <TabsTrigger className="h-12 flex-none rounded-md px-4 text-sm font-semibold text-muted-foreground after:hidden data-active:!bg-primary data-active:!text-primary-foreground data-active:shadow-sm hover:bg-accent hover:text-foreground" key={item.value} value={item.value}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent className="mt-0" value="plans">
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <TableHeaderBar
              count={filteredPlans.length}
              onSearchChange={(value) => {
                setPlansSearch(value);
                setPlansPage(1);
              }}
              onStatusChange={(value) => {
                setPlansStatus(value);
                setPlansPage(1);
              }}
              icon={Layers3}
              search={plansSearch}
              searchId="plans-search"
              status={plansStatus}
              title="Planes"
            />
            <div className="overflow-x-auto border-y border-border">
              <PlansTable items={plansPageData.items} loading={loading} />
            </div>
            <TablePagination
              page={plansPageData.page}
              total={filteredPlans.length}
              totalPages={plansPageData.totalPages}
              onPageChange={setPlansPage}
            />
          </section>
        </TabsContent>

        <TabsContent className="mt-0" value="addons">
          <section className="rounded-lg border border-border bg-card shadow-sm">
            <TableHeaderBar
              count={filteredAddons.length}
              onSearchChange={(value) => {
                setAddonsSearch(value);
                setAddonsPage(1);
              }}
              onStatusChange={(value) => {
                setAddonsStatus(value);
                setAddonsPage(1);
              }}
              icon={Puzzle}
              search={addonsSearch}
              searchId="addons-search"
              status={addonsStatus}
              title="Add-ons"
            />
            <div className="overflow-x-auto border-y border-border">
              <AddonsTable items={addonsPageData.items} loading={loading} />
            </div>
            <TablePagination
              page={addonsPageData.page}
              total={filteredAddons.length}
              totalPages={addonsPageData.totalPages}
              onPageChange={setAddonsPage}
            />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

const tabs: { value: ProductTab; label: string }[] = [
  { value: "plans", label: "Planes" },
  { value: "addons", label: "Add-ons" },
];

function TableHeaderBar({
  count,
  icon: Icon,
  onSearchChange,
  onStatusChange,
  search,
  searchId,
  status,
  title,
}: {
  count: number;
  icon: typeof Layers3;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  search: string;
  searchId: string;
  status: StatusFilter;
  title: string;
}) {
  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-secondary text-primary">
            <Icon className="size-5" />
          </span>
          <h2 className="text-lg font-bold">{title}</h2>
          <span className="grid size-7 place-items-center rounded-full bg-muted text-sm font-bold text-muted-foreground">{count}</span>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Label className="sr-only" htmlFor={searchId}>Buscar</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-12 rounded-lg bg-card pl-12 text-sm"
              id={searchId}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Buscar por código, nombre o proveedor"
              value={search}
            />
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button className="h-12 min-w-48 justify-start gap-3 rounded-lg bg-card px-4 font-semibold" variant="outline" />}>
            <Filter className="size-4 text-muted-foreground" />
            {status === "all" ? "Todos los estados" : label(status)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuRadioGroup onValueChange={(value) => onStatusChange(value as StatusFilter)} value={status}>
              {statuses.map((item) => (
                <DropdownMenuRadioItem key={item} value={item}>
                  {item === "all" ? "Todos los estados" : label(item)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function TablePagination({
  onPageChange,
  page,
  total,
  totalPages,
}: {
  onPageChange: (page: number) => void;
  page: number;
  total: number;
  totalPages: number;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-5 py-4 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between">
      <span>Página {page} de {totalPages} · {total} registros</span>
      <Pagination className="mx-0 w-fit justify-start md:justify-center">
        <PaginationContent>
          <PaginationItem>
            <Button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              type="button"
              variant="outline"
            >
              Anterior
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button disabled type="button" variant="secondary">
              {page}
            </Button>
          </PaginationItem>
          <PaginationItem>
            <Button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              type="button"
              variant="outline"
            >
              Siguiente
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  );
}

function getProductDetail(id: string) {
  const request = detailRequests.get(id) ?? Promise.all([
    getCatalogProduct(id),
    listCatalogPlans({ product_id: id, limit: 100 }),
    listCatalogAddons({ product_id: id, limit: 100 }),
  ]).then(([product, plans, addons]) => ({
    addons: unwrapItems(addons),
    plans: unwrapItems(plans),
    product,
  })).finally(() => detailRequests.delete(id));

  detailRequests.set(id, request);
  return request;
}

function getTab(value: string | null): ProductTab {
  return value === "addons" ? "addons" : "plans";
}

function paginate<T>(items: T[], page: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page: safePage,
    totalPages,
  };
}

function unwrapItems<T>(data: T[] | { items: T[] }) {
  return Array.isArray(data) ? data : data.items;
}

function filterPlans(items: CatalogPlan[], search: string, status: StatusFilter) {
  const query = search.trim().toLowerCase();
  return items.filter((plan) =>
    (status === "all" || plan.status === status) &&
    (!query || [
      plan.code,
      plan.name,
      primaryProviderPrice(plan)?.provider ?? "",
      primaryPrice(plan)?.currency ?? "",
      primaryPrice(plan)?.billingInterval ?? "",
    ].some((value) => value.toLowerCase().includes(query))),
  );
}

function filterAddons(items: CatalogAddon[], search: string, status: StatusFilter) {
  const query = search.trim().toLowerCase();
  return items.filter((addon) =>
    (status === "all" || addon.status === status) &&
    (!query || [addon.code, addon.name, addon.provider, addon.currency, addon.billingInterval, addon.type].some((value) => value.toLowerCase().includes(query))),
  );
}

function label(value: string) {
  return value.replaceAll("_", " ");
}
