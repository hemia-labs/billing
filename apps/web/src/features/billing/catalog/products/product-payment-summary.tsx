"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import type { CatalogProduct } from "../catalog-api";
import { getProductPaypalConnection, type ProductPaypalConnectionState } from "../../integrations/payments/paypal-connection-api";
import { paymentIntegrationHref } from "../../integrations/payments/payment-products";

export function ProductPaymentSummary({ product, canManage }: { product: CatalogProduct; canManage: boolean }) {
  const [data, setData] = useState<ProductPaypalConnectionState | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setData(null);
      setError("");
      try {
        const next = await getProductPaypalConnection(product.id, controller.signal);
        if (!controller.signal.aborted) setData(next);
      } catch (cause) {
        if (controller.signal.aborted) return;
        if (cause instanceof ApiError && cause.status === 401) { redirectToLogin(); return; }
        setError(apiErrorMessage(cause, "No se pudo cargar el proveedor de pago."));
      }
    });
    return () => controller.abort();
  }, [product.id, retry]);
  return <ProductPaymentSummaryView canManage={canManage} data={data} error={error} onRetry={() => setRetry((value) => value + 1)} productId={product.id} />;
}

export function ProductPaymentSummaryView({ productId, canManage, data, error, onRetry }: {
  productId: string;
  canManage: boolean;
  data: ProductPaypalConnectionState | null;
  error: string;
  onRetry: () => void;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3"><CreditCard aria-hidden="true" className="size-5 text-primary" /><h2 className="text-lg font-semibold">Proveedor de pago</h2></div>
        <Button render={<Link href={paymentIntegrationHref(productId)} />} type="button" variant="outline">{canManage ? "Administrar en Integraciones" : "Ver en Integraciones"}</Button>
      </div>
      {error ? <Alert className="mt-5" role="alert" variant="destructive"><span className="min-w-0 flex-1">{error}</span><Button onClick={onRetry} type="button" variant="outline">Reintentar</Button></Alert> : data ? (
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Proveedor</dt><dd className="mt-1 font-medium">PayPal</dd></div>
          <div><dt className="text-muted-foreground">Tipo de cobro</dt><dd className="mt-1 font-medium">Suscripciones recurrentes</dd></div>
          <div><dt className="text-muted-foreground">Conexión</dt><dd className="mt-1 font-medium">{data.connection ? "Propia del producto" : "Configuración global heredada"}</dd></div>
          <div><dt className="text-muted-foreground">Estado de la conexión</dt><dd className="mt-1 font-medium">{data.connection ? data.connection.enabled ? data.encryptionConfigured ? "Habilitada para nuevas contrataciones" : "Configuración no disponible" : "Deshabilitada para nuevas contrataciones" : "Disponibilidad no verificada"}</dd></div>
        </dl>
      ) : <p className="mt-5 text-sm text-muted-foreground" role="status">Cargando proveedor de pago…</p>}
    </section>
  );
}
