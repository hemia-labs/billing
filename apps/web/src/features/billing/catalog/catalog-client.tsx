"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Eye, Filter, MoreHorizontal, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [search, setSearch] = useState("");

  async function load(nextFilters = filters, dedupe = true) {
    setLoading(true);
    setMessage("");

    try {
      setData(await listProducts(nextFilters, dedupe));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudieron cargar los productos."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!canRead) return;
    void Promise.resolve().then(() => load(filters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRead, queryKey]);

  const pushQuery = (nextFilters: CatalogFilters) => {
    const params = new URLSearchParams();
    params.set("limit", String(limit));
    params.set("page", String(nextFilters.page ?? 1));
    setIfAny(params, "status", nextFilters.status);
    router.push(`${pathname}?${params.toString()}`);
  };

  if (!canRead) {
    return (
      <Alert variant="destructive"><AlertDescription>No tienes permiso para consultar productos.</AlertDescription></Alert>
    );
  }

  const page = data?.page ?? filters.page ?? 1;
  const total = data?.total ?? 0;
  const pageLimit = data?.limit ?? limit;
  const totalPages = Math.max(1, Math.ceil(total / pageLimit));
  const hasNext = page < totalPages;
  const items = data?.items ?? [];
  const filteredItems = filterProducts(items, search);

  return (
    <div className="space-y-5">
      {message ? (
        <Alert variant="destructive"><AlertDescription>{message}</AlertDescription></Alert>
      ) : null}

      <Card className="rounded-lg border border-border py-0 shadow-sm ring-0">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="min-w-0 flex-1">
              <Label className="sr-only" htmlFor="products-search">Buscar</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="h-12 bg-card pl-10 text-sm"
                  id="products-search"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar por código, nombre o descripción"
                  value={search}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Label className="sr-only">Estado</Label>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button className="h-12 min-w-56 justify-start gap-2 bg-card px-3 font-semibold" variant="outline" />}>
                  <Filter className="size-4 text-muted-foreground" />
                  {statusLabel(filters.status)}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuRadioGroup
                    onValueChange={(value) => pushQuery({ ...filters, page: 1, status: value === "all" ? undefined : value as CatalogStatus })}
                    value={filters.status ?? "all"}
                  >
                    <DropdownMenuRadioItem value="all">Todos los estados</DropdownMenuRadioItem>
                    {productStatuses.map((status) => <DropdownMenuRadioItem key={status} value={status}>{label(status)}</DropdownMenuRadioItem>)}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button aria-label="Recargar productos" className="size-12" onClick={() => void load(filters, false)} size="icon" variant="outline"><RefreshCw className="size-5" /></Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-0 rounded-lg border border-border py-0 shadow-sm ring-0">
        <CardContent className="p-0">
          <ProductsTable items={filteredItems} loading={loading} />
        </CardContent>
        <CardFooter className="flex items-center justify-between border-t border-border bg-card px-5 py-4 text-sm text-muted-foreground">
          <span>Página {page} · {total} registros</span>
          <ProductPagination
            currentPage={page}
            disabled={loading}
            filters={filters}
            hasNext={hasNext}
            pathname={pathname}
            totalPages={totalPages}
          />
        </CardFooter>
      </Card>
    </div>
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

function ProductsTable({ items, loading }: { items: CatalogProduct[]; loading: boolean }) {
  return (
    <Table className="min-w-4xl">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-5 text-xs font-bold text-muted-foreground">Producto</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Nombre</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Estado</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Descripción</TableHead>
          <TableHead className="px-5 text-right">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={5} text="Cargando productos..." /> : items.length === 0 ? <EmptyRow colSpan={5} text="No hay productos para mostrar." /> : items.map((product) => (
          <TableRow className="h-[4.5rem] hover:bg-muted/30" key={product.id}>
            <TableCell className="px-5">
              <Link className="font-bold text-primary hover:underline" href={`/products/${product.id}`}>{product.code}</Link>
            </TableCell>
            <TableCell>{product.name}</TableCell>
            <TableCell><StatusBadge status={product.status} /></TableCell>
            <TableCell className="max-w-96 truncate text-muted-foreground">{product.description ?? "Sin descripción"}</TableCell>
            <TableCell className="px-5 text-right"><ProductActions productId={product.id} /></TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ProductActions({ productId }: { productId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="Acciones del producto" className="size-12 border-border" size="icon" variant="outline" />}>
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
    <Table className="min-w-5xl">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-5 text-xs font-bold text-muted-foreground">Código</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Producto</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Nombre</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Proveedor</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Precio</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Intervalo</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Estado</TableHead>
          <TableHead className="px-5 text-right text-xs font-bold text-muted-foreground">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={8} text="Cargando planes..." /> : items.length === 0 ? <EmptyRow colSpan={8} text="No hay planes para mostrar." /> : items.map((plan) => (
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
    <TableRow className="h-[4.5rem] hover:bg-muted/30">
      <TableCell className="px-5 font-semibold">{plan.code}</TableCell>
      <TableCell>{plan.productCode ?? plan.productId}</TableCell>
      <TableCell>{plan.name}</TableCell>
      <TableCell>{providerPrice ? label(providerPrice.provider) : "Sin proveedor"}</TableCell>
      <TableCell>{price ? `${price.currency} ${price.amount}` : "Sin precio"}</TableCell>
      <TableCell>{price ? label(price.billingInterval) : "Sin intervalo"}</TableCell>
      <TableCell><StatusBadge status={plan.status} /></TableCell>
      <TableCell className="px-5 text-right"><PlanActions planId={plan.id} /></TableCell>
    </TableRow>
  );
}

function PlanActions({ planId }: { planId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button aria-label="Acciones del plan" className="size-12 border-border" size="icon" variant="outline" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem render={<Link href={`/products/plans/${planId}`} />}>
          <Eye className="size-4" />
          Ver detalle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AddonsTable({ items, loading }: { items: CatalogAddon[]; loading: boolean }) {
  return (
    <Table className="min-w-5xl">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-10 px-5 text-xs font-bold text-muted-foreground">Producto</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Código</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Nombre</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Proveedor</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Precio unitario</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Intervalo</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Tipo</TableHead>
          <TableHead className="text-xs font-bold text-muted-foreground">Estado</TableHead>
          <TableHead className="px-5 text-right text-xs font-bold text-muted-foreground">Acciones</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading ? <EmptyRow colSpan={9} text="Cargando add-ons..." /> : items.length === 0 ? <EmptyRow colSpan={9} text="No hay add-ons para mostrar." /> : items.map((addon) => (
          <TableRow className="h-[4.5rem] hover:bg-muted/30" key={addon.id}>
            <TableCell className="px-5">{addon.productCode}</TableCell>
            <TableCell className="font-semibold">{addon.code}</TableCell>
            <TableCell>{addon.name}</TableCell>
            <TableCell>{label(addon.provider)}</TableCell>
            <TableCell>{addon.currency} {addon.unitPrice}</TableCell>
            <TableCell>{label(addon.billingInterval)}</TableCell>
            <TableCell>{label(addon.type)}</TableCell>
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
      <DropdownMenuTrigger render={<Button aria-label="Acciones del add-on" className="size-12 border-border" size="icon" variant="outline" />}>
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem render={<Link href={`/products/addons/${addonId}`} />}>
          <Eye className="size-4" />
          Ver detalle
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return <TableRow><TableCell className="h-24 px-5 text-center text-muted-foreground" colSpan={colSpan}>{text}</TableCell></TableRow>;
}

function StatusBadge({ status }: { status: CatalogStatus }) {
  if (status === "active") {
    return <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50" variant="secondary"><CheckCircle2 className="size-3" />{label(status)}</Badge>;
  }

  return <Badge variant={status === "archived" ? "outline" : "secondary"}>{label(status)}</Badge>;
}

function getFilters(searchParams: URLSearchParams): CatalogFilters {
  return {
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

function statusLabel(status: CatalogStatus | undefined) {
  return status ? label(status) : "Todos los estados";
}

function filterProducts(items: CatalogProduct[], search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return items;
  return items.filter((product) =>
    [product.code, product.name, product.description ?? ""].some((value) => value.toLowerCase().includes(query)),
  );
}
