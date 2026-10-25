"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Eye, Filter, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { StatusBadge as ZunoStatusBadge } from "@/components/zuno/status-badge";
import { Button } from "@/components/zuno/button";
import { CardContent, CardFooter } from "@/components/zuno/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/zuno/dropdown-menu";
import { Alert, AlertDescription } from "@/components/zuno/alert";
import { Input } from "@/components/zuno/input";
import { Label } from "@/components/zuno/label";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission, useSession } from "@/components/auth-gate";
import {
  ApiError,
  apiErrorMessage,
  redirectToLogin,
} from "@/lib/api";
import {
  type CatalogAddon,
  type CatalogFilters,
  type CatalogPage,
  type CatalogPlan,
  type CatalogProduct,
  type CatalogStatus,
  listCatalogProducts,
  primaryPrice,
  primaryProviderPrice,
} from "./catalog-api";

const limit = 20;
const productStatuses: CatalogStatus[] = ["active", "inactive"];
const productRequests = new Map<string, Promise<CatalogPage<CatalogProduct>>>();

export function CatalogClient() {
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryKey = searchParams.toString();
  const filters = useMemo(() => getFilters(new URLSearchParams(queryKey)), [queryKey]);
  const [data, setData] = useState<CatalogPage<CatalogProduct> | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<number | null>(null);
  const requestId = useRef(0);

  async function load(nextFilters = filters, dedupe = true) {
    const currentRequest = ++requestId.current;
    setLoading(true);
    setMessage("");

    try {
      const result = await listProducts(nextFilters, dedupe);
      if (currentRequest === requestId.current) setData(result);
    } catch (error) {
      if (currentRequest !== requestId.current) return;
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudieron cargar los productos."));
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRead) return;
    void Promise.resolve().then(() => load(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, queryKey]);

  useEffect(() => {
    if (searchInputRef.current) searchInputRef.current.value = filters.q ?? "";
  }, [filters.q]);

  useEffect(() => () => {
    if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
  }, [queryKey]);

  const pushQuery = (nextFilters: CatalogFilters) => {
    if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    router.push(pageHref(pathname, nextFilters, nextFilters.page ?? 1), { scroll: false });
  };

  const scheduleSearch = (value: string) => {
    if (searchTimeoutRef.current) window.clearTimeout(searchTimeoutRef.current);
    const q = value.trim();
    if (q === (filters.q ?? "")) return;
    searchTimeoutRef.current = window.setTimeout(() => {
      router.replace(pageHref(pathname, { ...filters, q: q || undefined }, 1), { scroll: false });
    }, 300);
  };

  if (!canRead) {
    return (
      <CardContent className="p-5">
        <Alert variant="destructive"><AlertDescription>No tienes permiso para consultar productos.</AlertDescription></Alert>
      </CardContent>
    );
  }

  const page = data?.page ?? filters.page ?? 1;
  const total = data?.total ?? 0;
  const pageLimit = data?.limit ?? limit;
  const totalPages = Math.max(1, Math.ceil(total / pageLimit));
  const hasNext = page < totalPages;
  const items = data?.items ?? [];
  const firstItem = (page - 1) * pageLimit + 1;
  const lastItem = (page - 1) * pageLimit + items.length;
  const rangeLabel = items.length === 0
    ? `0 de ${total} ${total === 1 ? "producto" : "productos"}`
    : `${firstItem}${firstItem === lastItem ? "" : `–${lastItem}`} de ${total} ${total === 1 ? "producto" : "productos"}`;
  const emptyMessage = filters.q || filters.status ? "No hay productos que coincidan con los filtros." : "Aún no hay productos.";

  return (
    <>
      <CardContent className="space-y-4 p-5">
        {message ? (
          <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span aria-live="polite" className="text-sm text-muted-foreground">{loading ? "Cargando..." : `${total} ${total === 1 ? "producto" : "productos"}`}</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="w-full sm:w-72">
              <Label className="sr-only" htmlFor="products-search">Buscar por código, nombre o descripción</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-10 text-sm"
                  defaultValue={filters.q ?? ""}
                  id="products-search"
                  maxLength={120}
                  onChange={(event) => scheduleSearch(event.target.value)}
                  placeholder="Buscar productos"
                  ref={searchInputRef}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button className="min-w-28 px-4 font-semibold" variant="outline" />}>
                  <Filter className="size-4" />Filtros
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuRadioGroup
                    aria-label="Estado del producto"
                    onValueChange={(value) => pushQuery({ ...filters, q: searchInputRef.current?.value.trim() || undefined, page: 1, status: value === "all" ? undefined : value as CatalogStatus })}
                    value={filters.status ?? "all"}
                  >
                    <DropdownMenuRadioItem value="all">Todos los estados</DropdownMenuRadioItem>
                    {productStatuses.map((status) => <DropdownMenuRadioItem key={status} value={status}>{label(status)}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button aria-label="Recargar productos" onClick={() => void load(filters, false)} size="icon" variant="ghost"><RefreshCw className="size-4" /></Button>
            </div>
          </div>
        </div>
      </CardContent>

      <div className="border-t border-border">
        <ProductsTable emptyMessage={emptyMessage} items={items} loading={loading} />
      </div>
      <CardFooter className="flex flex-col gap-3 border-t border-border bg-card px-5 py-4 text-sm text-muted-foreground sm:flex-row sm:justify-between">
        <span>{loading ? "Cargando..." : rangeLabel}</span>
        <ProductPagination
          currentPage={page}
          disabled={loading}
          filters={filters}
          hasNext={hasNext}
          pathname={pathname}
          totalPages={totalPages}
        />
      </CardFooter>
    </>
  );
}

function ProductPagination({
  currentPage,
  disabled,
  filters,
  hasNext,
  pathname,
  totalPages,
}: {
  currentPage: number;
  disabled: boolean;
  filters: CatalogFilters;
  hasNext: boolean;
  pathname: string;
  totalPages: number;
}) {
  const previousPage = Math.max(1, currentPage - 1);
  const nextPage = Math.min(totalPages, currentPage + 1);

  return (
    <Pagination className="mx-0 w-fit">
      <PaginationContent>
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={disabled || currentPage <= 1}
            className={disabled || currentPage <= 1 ? "pointer-events-none opacity-50" : undefined}
            href={pageHref(pathname, filters, previousPage)}
            text="Anterior"
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLink href={pageHref(pathname, filters, currentPage)} isActive>
            {currentPage}
          </PaginationLink>
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            aria-disabled={disabled || !hasNext}
            className={disabled || !hasNext ? "pointer-events-none opacity-50" : undefined}
            href={pageHref(pathname, filters, nextPage)}
            text="Siguiente"
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}

function ProductsTable({ emptyMessage, items, loading }: { emptyMessage: string; items: CatalogProduct[]; loading: boolean }) {
  return (
    <Table className="min-w-[36rem] table-fixed md:min-w-0">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 w-[32%] px-4 text-xs font-medium text-muted-foreground md:w-[25%] md:px-5">Nombre</TableHead>
          <TableHead className="w-[28%] text-xs font-medium text-muted-foreground md:w-[20%]">Código</TableHead>
          <TableHead className="w-24 text-xs font-medium text-muted-foreground md:w-32">Estado</TableHead>
          <TableHead className="hidden text-xs font-medium text-muted-foreground md:table-cell">Descripción</TableHead>
          <TableHead className="w-14 px-3 text-right md:w-16 md:px-5"><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={5} text="Cargando productos..." /> : items.length === 0 ? <EmptyRow colSpan={5} text={emptyMessage} /> : items.map((product) => (
          <TableRow className="h-[60px] hover:bg-muted/30" key={product.id}>
            <TableCell className="min-w-0 px-4 md:px-5">
              <Link className="block truncate font-semibold text-foreground hover:underline" href={`/products/${product.id}`} title={product.name}>{product.name}</Link>
            </TableCell>
            <TableCell className="max-w-0 text-muted-foreground"><span className="block truncate" title={product.code}>{product.code}</span></TableCell>
            <TableCell><StatusBadge status={product.status} /></TableCell>
            <TableCell className="hidden max-w-0 text-muted-foreground md:table-cell"><span className="block truncate">{product.description ?? "Sin descripción"}</span></TableCell>
            <TableCell className="px-3 text-right md:px-5"><ProductActions productId={product.id} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProductActions({ productId }: { productId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="Acciones del producto" className="size-9" size="icon" variant="ghost" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem render={<Link href={`/products/${productId}`} />}>
          <Eye className="size-4" />
          Ver detalle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function PlansTable({ items, loading }: { items: CatalogPlan[]; loading: boolean }) {
  return (
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-5 text-xs font-medium text-muted-foreground">Nombre</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Código</TableHead>
          <TableHead className="text-right text-xs font-medium text-muted-foreground">Precio</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Proveedor</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Estado</TableHead>
          <TableHead className="w-14 px-5 text-right"><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={6} text="Cargando planes..." /> : items.length === 0 ? <EmptyRow colSpan={6} text="No hay planes para mostrar." /> : items.map((plan) => (
          <PlanRow key={plan.id} plan={plan} />
        ))}
      </TableBody>
    </Table>
  );
}

function PlanRow({ plan }: { plan: CatalogPlan }) {
  const price = primaryPrice(plan);
  const providerPrice = primaryProviderPrice(plan);

  return (
    <TableRow className="h-12 hover:bg-muted/30">
      <TableCell className="px-5">
        <Link className="block truncate font-semibold text-foreground hover:underline" href={"/products/plans/" + plan.id} title={plan.name}>{plan.name}</Link>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">{plan.code}</TableCell>
      <TableCell className="whitespace-nowrap text-right tabular-nums">
        {price ? formatPrice(price.currency, price.amount, price.billingInterval) : "Sin precio"}
      </TableCell>
      <TableCell>{providerPrice ? providerLabel(providerPrice.provider) : "Sin proveedor"}</TableCell>
      <TableCell><StatusBadge status={plan.status} /></TableCell>
      <TableCell className="px-5 text-right"><PlanActions planId={plan.id} /></TableCell>
    </TableRow>
  );
}

function PlanActions({ planId }: { planId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="Acciones del plan" className="size-8" size="icon" variant="ghost" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem render={<Link href={"/products/plans/" + planId} />}>
          <Eye className="size-4" />Ver detalle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddonsTable({ items, loading }: { items: CatalogAddon[]; loading: boolean }) {
  return (
    <Table className="min-w-[760px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-5 text-xs font-medium text-muted-foreground">Nombre</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Código</TableHead>
          <TableHead className="text-right text-xs font-medium text-muted-foreground">Precio</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Proveedor</TableHead>
          <TableHead className="text-xs font-medium text-muted-foreground">Estado</TableHead>
          <TableHead className="w-14 px-5 text-right"><span className="sr-only">Acciones</span></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={6} text="Cargando add-ons..." /> : items.length === 0 ? <EmptyRow colSpan={6} text="No hay add-ons para mostrar." /> : items.map((addon) => (
          <TableRow className="h-12 hover:bg-muted/30" key={addon.id}>
            <TableCell className="px-5">
              <Link className="block truncate font-semibold text-foreground hover:underline" href={"/products/addons/" + addon.id} title={addon.name}>{addon.name}</Link>
            </TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{addon.code}</TableCell>
            <TableCell className="whitespace-nowrap text-right tabular-nums">{formatPrice(addon.currency, addon.unitPrice, addon.billingInterval)}</TableCell>
            <TableCell>{providerLabel(addon.provider)}</TableCell>
            <TableCell><StatusBadge status={addon.status} /></TableCell>
            <TableCell className="px-5 text-right"><AddonActions addonId={addon.id} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function AddonActions({ addonId }: { addonId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="Acciones del add-on" className="size-8" size="icon" variant="ghost" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem render={<Link href={"/products/addons/" + addonId} />}>
          <Eye className="size-4" />Ver detalle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatPrice(currency: string, amount: string, interval: string) {
  const number = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(amount));
  const period = interval === "month" || interval === "monthly" ? "mes" : "año";
  return currency + " " + number + " / " + period;
}

function providerLabel(provider: string) {
  return ({ paypal: "PayPal", stripe: "Stripe", mercado_pago: "Mercado Pago", manual_transfer: "Transferencia" } as Record<string, string>)[provider] ?? provider;
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <TableRow><TableCell className="h-24 px-5 text-center text-muted-foreground" colSpan={colSpan}>{text}</TableCell></TableRow>;
}

function StatusBadge({ status }: { status: CatalogStatus }) {
  if (status === "active") {
    return <ZunoStatusBadge status="success">Activo</ZunoStatusBadge>;
  }

  return <ZunoStatusBadge status={status === "archived" ? "neutral" : "warning"}>{status === "archived" ? "Archivado" : "Inactivo"}</ZunoStatusBadge>;
}

function getFilters(searchParams: URLSearchParams): CatalogFilters {
  return {
    q: searchParams.get("q") || undefined,
    status: (searchParams.get("status") || undefined) as CatalogStatus | undefined,
    page: Number(searchParams.get("page") || 1),
    limit,
  };
}

function setIfAny(params: URLSearchParams, key: string, value: string | number | undefined) {
  if (value) params.set(key, String(value));
}

function pageHref(pathname: string, filters: CatalogFilters, page: number) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("page", String(page));
  setIfAny(params, "q", filters.q);
  setIfAny(params, "status", filters.status);
  return `${pathname}?${params.toString()}`;
}

function listProducts(filters: CatalogFilters, dedupe: boolean) {
  if (!dedupe) return listCatalogProducts(filters);

  const key = JSON.stringify(filters);
  const request = productRequests.get(key) ?? listCatalogProducts(filters).finally(() => productRequests.delete(key));
  productRequests.set(key, request);
  return request;
}

function label(value: string) {
  return value.replaceAll("_", " ");
}
