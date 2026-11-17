"use client";

import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { savedPaymentConnectionRows, type PaymentConnectionRow } from "./payment-products";

export function PaypalConnectionsList({ rows, loading, canManage, onOpen, onRetry }: {
  rows: PaymentConnectionRow[] | null;
  loading: boolean;
  canManage: boolean;
  onOpen: (productId?: string) => void;
  onRetry: () => void;
}) {
  const saved = rows ? savedPaymentConnectionRows(rows) : null;
  return (
    <section aria-labelledby="paypal-connections-heading" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5"><h2 className="text-lg font-semibold" id="paypal-connections-heading">Conexiones creadas</h2>{(rows?.some((row) => row.error) || (!loading && rows === null)) ? <Button onClick={onRetry} type="button" variant="outline">Reintentar consultas</Button> : null}</div>
      {loading ? <p className="px-5 pb-5 text-sm text-muted-foreground" role="status">Cargando conexiones…</p> : saved?.length ? (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[42rem] text-left text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Producto</th><th className="px-5 py-3 font-medium">Conexión</th><th className="px-5 py-3 font-medium">Entorno</th><th className="px-5 py-3 font-medium">Estado</th><th className="px-5 py-3"><span className="sr-only">Acciones</span></th></tr></thead>
            <tbody className="divide-y divide-border">
              {saved.map(({ product, data, error }) => {
                const connection = data?.connection ?? data?.draft;
                return (
                  <tr key={product.id}>
                    <td className="px-5 py-4"><p className="font-medium">{product.name}</p><p className="mt-1 text-xs text-muted-foreground">{product.code}</p></td>
                    {error ? <td className="px-5 py-4 text-destructive" colSpan={3}><span role="alert">{error}</span></td> : <>
                      <td className="px-5 py-4">{connection?.name}</td>
                      <td className="px-5 py-4">{connection?.environment === "live" ? "Producción" : "Sandbox"}</td>
                      <td className="px-5 py-4"><div className="flex flex-wrap gap-2"><Badge variant="outline">{data?.connection ? !data.connection.enabled ? "Deshabilitada" : data.encryptionConfigured ? "Habilitada" : "No disponible" : "Global sin verificar"}</Badge>{data?.draft ? <Badge variant="secondary">Borrador guardado</Badge> : null}</div></td>
                    </>}
                    <td className="px-5 py-4 text-right"><Button aria-label={`${canManage ? "Editar" : "Ver"} PayPal de ${product.name}`} onClick={() => onOpen(product.id)} type="button" variant="outline">{canManage ? "Editar" : "Ver"}</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : <div className="space-y-4 px-5 pb-5"><p className="text-sm text-muted-foreground">{rows === null ? "No se pudieron consultar las conexiones." : "Todavía no hay conexiones de PayPal creadas."}</p>{rows !== null && canManage ? <Button onClick={() => onOpen()} type="button" variant="outline">Crear conexión</Button> : null}</div>}
    </section>
  );
}
