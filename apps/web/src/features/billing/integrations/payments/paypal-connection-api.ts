import { ApiError, apiBaseUrl, apiFetch } from "@/lib/api";

export type ProductPaypalConnection = {
  id: string;
  productId: string;
  name: string;
  environment: "sandbox" | "live";
  clientId: string;
  webhookId: string;
  enabled: boolean;
  hasClientSecret: boolean;
  webhookPath: string;
  createdAt: string;
  updatedAt: string;
  isDraft?: boolean;
};

export type ProductPaypalConnectionState = {
  connection: ProductPaypalConnection | null;
  draft: ProductPaypalConnection | null;
  source: "product" | "global";
  encryptionConfigured: boolean;
};

export type ProductPaypalConnectionPayload = {
  name: string;
  environment: ProductPaypalConnection["environment"];
  clientId: string;
  clientSecret?: string;
  webhookId: string;
  draftId?: string;
  expectedUpdatedAt?: string;
};

const connectionPath = (productId: string) => `/billing/console/catalog/products/${encodeURIComponent(productId)}/paypal-connection`;

export function getProductPaypalConnection(productId: string, signal?: AbortSignal) {
  return apiFetch<ProductPaypalConnectionState>(connectionPath(productId), { cache: "no-store", signal });
}

export function paypalConnectionSaveUrl(baseUrl: string, productId: string) {
  const url = new URL(baseUrl.replace(/\/$/, "") + connectionPath(productId));
  const localDevelopment = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && process.env.NODE_ENV !== "production";
  if ((url.protocol !== "https:" && !localDevelopment) || url.username || url.password) {
    throw new Error("Guardar credenciales requiere una conexión HTTPS.");
  }
  return url;
}

async function mutatePaypalConnection(productId: string, path: string, method: "PUT" | "POST" | "PATCH", body: Record<string, unknown>) {
  if (typeof window !== "undefined" && !window.isSecureContext) throw new Error("Guardar credenciales requiere una página segura.");
  paypalConnectionSaveUrl(apiBaseUrl, productId);
  try {
    return await apiFetch<ProductPaypalConnectionState>(path, { method, body, cache: "no-store", redirect: "error" });
  } catch (error) {
    // Never surface a provider or validation response that could echo submitted credentials.
    if (error instanceof ApiError) throw new ApiError(error.status, paypalConnectionError(error));
    throw new Error("No se pudo guardar la conexión. Intenta de nuevo.");
  }
}

export function saveProductPaypalConnection(productId: string, payload: ProductPaypalConnectionPayload) {
  return mutatePaypalConnection(productId, connectionPath(productId), "PUT", payload);
}

export type ActivatePaypalConnectionPayload = {
  expectedUpdatedAt: string;
  expectedCurrentConnectionId: string | null;
  expectedCurrentUpdatedAt: string | null;
};

export function activateProductPaypalConnection(productId: string, draftId: string, payload: ActivatePaypalConnectionPayload) {
  return mutatePaypalConnection(productId, `/billing/console/catalog/products/${encodeURIComponent(productId)}/paypal-connections/${encodeURIComponent(draftId)}/activate`, "POST", payload);
}

export function setProductPaypalConnectionStatus(productId: string, connectionId: string, enabled: boolean) {
  return mutatePaypalConnection(productId, `/billing/console/catalog/products/${encodeURIComponent(productId)}/paypal-connections/${encodeURIComponent(connectionId)}/status`, "PATCH", { enabled });
}

export function paypalConnectionError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Sesión expirada. Inicia sesión de nuevo.";
    if (error.status === 403) return "No tienes permiso para administrar esta conexión.";
    if (error.status === 404) return "No se encontró el producto o su conexión.";
    if (error.status === 409) return "La conexión cambió o no puede guardarse en su estado actual. Recarga los datos y vuelve a intentarlo.";
    if (error.status === 429) return "Demasiadas solicitudes. Espera un momento y vuelve a intentarlo.";
    if (error.status >= 500) return "El servicio de conexiones no está disponible. Intenta de nuevo más tarde.";
  }
  return "No se pudo guardar la conexión. Revisa los datos y vuelve a intentarlo.";
}

export type ProductPaypalConnectionHistory = {
  connections: Array<ProductPaypalConnection & { isCurrent: boolean; isDraft?: boolean }>;
  encryptionConfigured: boolean;
};

export type PaypalCredentialRotation = { clientSecret: string; webhookId?: string };

export function listProductPaypalConnections(productId: string, signal?: AbortSignal) {
  return apiFetch<ProductPaypalConnectionHistory>(`/billing/console/catalog/products/${encodeURIComponent(productId)}/paypal-connections`, { cache: "no-store", signal });
}

export function rotateProductPaypalCredentials(productId: string, connectionId: string, payload: PaypalCredentialRotation) {
  return mutatePaypalConnection(productId, `/billing/console/catalog/products/${encodeURIComponent(productId)}/paypal-connections/${encodeURIComponent(connectionId)}`, "PATCH", payload);
}
