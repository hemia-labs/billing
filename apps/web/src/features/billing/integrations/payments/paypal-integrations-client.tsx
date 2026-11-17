"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, X } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { hasPermission, useSession } from "@/components/auth-gate";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import type { CatalogProduct } from "../../catalog/catalog-api";
import { loadPaymentConnectionRows, loadPaymentProducts, paymentIntegrationHref, paymentPanelSelection, type PaymentConnectionRow } from "./payment-products";
import { PaypalProductConnection } from "./paypal-product-connection";
import { PaypalConnectionsList } from "./paypal-connections-list";

export function PaypalIntegrationsClient() {
  const session = useSession();
  const canRead = hasPermission(session, "billing.catalog.read");
  const canManage = hasPermission(session, "billing.catalog.manage");
  const router = useRouter();
  const selection = paymentPanelSelection(useSearchParams());
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [rows, setRows] = useState<PaymentConnectionRow[] | null>(null);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [connectionRetry, setConnectionRetry] = useState(0);
  const [changingProduct, startSelecting] = useTransition();
  const [closingPanel, startClosing] = useTransition();
  const [pendingSaves, setPendingSaves] = useState(0);
  const saving = pendingSaves > 0;
  const providerFocus = useRef<HTMLElement | null>(null);
  const panelOpen = selection.open && !closingPanel;
  useEffect(() => {
    if (!canRead) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setProducts(null);
      setError("");
      try {
        const next = await loadPaymentProducts(controller.signal);
        if (!controller.signal.aborted) setProducts(next);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
        setError(cause instanceof ApiError && cause.status === 429 ? "Espera un momento y reintenta." : apiErrorMessage(cause, "No se pudieron cargar los productos."));
      }
    });
    return () => controller.abort();
  }, [canRead, retry]);
  useEffect(() => {
    if (!canRead || !products) return;
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setRows(null);
      setLoadingConnections(true);
      try {
        const next = await loadPaymentConnectionRows(products, controller.signal);
        if (!controller.signal.aborted) setRows((saved) => next.map((row) => saved?.find((item) => item.product.id === row.product.id) ?? row));
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) redirectToLogin();
      } finally { if (!controller.signal.aborted) setLoadingConnections(false); }
    });
    return () => controller.abort();
  }, [canRead, products, connectionRetry]);
  const selectedProduct = products?.find((product) => product.id === selection.productId);
  const openProvider = (productId?: string) => {
    providerFocus.current = document.activeElement as HTMLElement | null;
    router.push(productId ? paymentIntegrationHref(productId) : paymentIntegrationHref() + "?provider=paypal", { scroll: false });
  };
  if (!canRead) return <PageHeading title="PayPal" description="No tienes permiso para consultar conexiones de pago." />;
  return (
    <div className="space-y-5">
      <PageHeading actions={canManage ? <Button onClick={() => openProvider()} type="button"><Plus aria-hidden="true" className="size-4" />Crear conexión</Button> : undefined} title="PayPal" description="Administra las conexiones de PayPal de tus productos." />
      {error ? <Alert role="alert" variant="destructive"><span className="min-w-0 flex-1">{error}</span><Button onClick={() => setRetry((value) => value + 1)} type="button" variant="outline">Reintentar</Button></Alert> : null}
      <PaypalConnectionsList canManage={canManage} loading={!products && !error || loadingConnections} onOpen={openProvider} onRetry={() => setConnectionRetry((value) => value + 1)} rows={rows} />
      <Sheet onOpenChange={(open, details) => { if (!open && saving) { details.cancel(); return; } if (!open) startClosing(() => router.replace(paymentIntegrationHref(), { scroll: false })); }} open={panelOpen}>
        <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl" finalFocus={providerFocus} showCloseButton={false}>
          <SheetHeader className="border-b border-border p-5 pr-16">
            <SheetTitle>Conectar PayPal</SheetTitle>
            <SheetDescription>Conexión por producto</SheetDescription>
          </SheetHeader>
          <SheetClose aria-label="Cerrar panel PayPal" disabled={saving} render={<Button className="absolute right-4 top-4" size="icon" type="button" variant="ghost" />}><X aria-hidden="true" className="size-4" /></SheetClose>
          {panelOpen ? (
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
              <div className="space-y-2">
                <label className="block text-sm font-medium" htmlFor="payment-product">Producto asociado</label>
                <Select disabled={!products || !products.length || changingProduct || saving} onValueChange={(value) => { if (value && value !== selection.productId) startSelecting(() => router.replace(paymentIntegrationHref(value), { scroll: false })); }} value={selectedProduct?.id ?? null}>
                  <SelectTrigger className="w-full" id="payment-product"><SelectValue placeholder="Selecciona un producto">{(value: string | null) => products?.find((product) => product.id === value)?.name ?? "Selecciona un producto"}</SelectValue></SelectTrigger>
                  <SelectContent>{products?.map((product) => <SelectItem key={product.id} value={product.id}>{product.name} · {product.code}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {error ? <Alert role="alert" variant="destructive">{error}</Alert> : !products ? <p className="text-sm text-muted-foreground" role="status">Cargando productos…</p> : changingProduct ? <p className="text-sm text-muted-foreground" role="status">Cambiando producto…</p> : selectedProduct ? (
                <PaypalProductConnection busy={saving} canManage={canManage} key={selectedProduct.id} onSavingChange={(pending) => setPendingSaves((value) => Math.max(0, value + (pending ? 1 : -1)))} onSaved={(data) => setRows((current) => [...(current?.filter((row) => row.product.id !== selectedProduct.id) ?? []), { product: selectedProduct, data }])} product={selectedProduct} />
              ) : <p className={selection.productId ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role={selection.productId ? "alert" : "status"}>{selection.productId ? "Producto no disponible. Selecciona otro." : products.length ? "Selecciona un producto para continuar." : "No hay productos disponibles."}</p>}
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
