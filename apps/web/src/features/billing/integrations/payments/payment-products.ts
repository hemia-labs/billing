import { type CatalogProduct, listCatalogProducts } from "../../catalog/catalog-api";
import { ApiError, apiErrorMessage } from "@/lib/api";
import { getProductPaypalConnection, type ProductPaypalConnectionState } from "./paypal-connection-api";

export function paymentIntegrationHref(productId?: string) {
  const query = new URLSearchParams();
  if (productId) query.set("product_id", productId);
  return "/integrations/payments/paypal" + (query.size ? "?" + query.toString() : "");
}

export async function loadPaymentProducts(signal?: AbortSignal): Promise<CatalogProduct[]> {
  const products: CatalogProduct[] = [];
  for (let page = 1; ; page++) {
    const next = await listCatalogProducts({ page, limit: 100 }, signal);
    products.push(...next.items);
    if (!next.items.length || page * next.limit >= next.total) break;
  }
  return products;
}

export type PaymentConnectionRow = {
  product: CatalogProduct;
  data: ProductPaypalConnectionState | null;
  error?: string;
};

export function paymentPanelSelection(query: Pick<URLSearchParams, "get">) {
  const productId = query.get("product_id")?.toLowerCase() ?? "";
  return { productId, open: Boolean(productId) || query.get("provider") === "paypal" };
}

export async function loadPaymentConnectionRows(products: CatalogProduct[], signal?: AbortSignal): Promise<PaymentConnectionRow[]> {
  const rows: PaymentConnectionRow[] = [];
  for (const product of products) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    try {
      rows.push({ product, data: await getProductPaypalConnection(product.id, signal) });
    } catch (error) {
      if (signal?.aborted || (error instanceof ApiError && error.status === 401)) throw error;
      rows.push({ product, data: null, error: error instanceof ApiError && error.status === 429 ? "Espera un momento y reintenta." : apiErrorMessage(error, "No se pudo consultar la conexión.") });
    }
  }
  return rows;
}

export function legacyPaymentIntegrationHref(query: Record<string, string | string[] | undefined>) {
  const productId = typeof query.product_id === "string" ? query.product_id : "";
  if (productId) return paymentIntegrationHref(productId);
  return query.provider === "paypal" ? paymentIntegrationHref() + "?provider=paypal" : null;
}

export function savedPaymentConnectionRows(rows: PaymentConnectionRow[]) {
  return rows.filter((row) => row.error || row.data?.connection || row.data?.draft);
}
