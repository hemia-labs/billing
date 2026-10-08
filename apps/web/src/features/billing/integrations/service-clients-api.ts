import { apiFetch } from "@/lib/api";

export type ServiceClient = {
  clientId: string;
  enabled: boolean;
  products: string[];
  organizationScope: "organizations" | "all_for_allowed_products";
  organizationIds?: string[];
  allowedReturnOrigins: string[];
  allowSharedCheckouts: boolean;
  source: "environment" | "database";
};
export type ServiceClientPayload = Omit<ServiceClient, "clientId" | "source">;
export type IdentityOAuthClient = {
  clientId: string;
  audience: string;
  grantTypes: string[];
  scopes: string[];
};
const path = "/billing/console/integrations/clients";
export const listServiceClients = (signal?: AbortSignal) =>
  apiFetch<ServiceClient[]>(path, { signal });
export const listIdentityOAuthClients = (signal?: AbortSignal) =>
  apiFetch<IdentityOAuthClient[]>(
    "/billing/console/integrations/identity-clients",
    { signal },
  );
export const saveServiceClient = (
  clientId: string,
  body: ServiceClientPayload,
) =>
  apiFetch<ServiceClient>(`${path}/${encodeURIComponent(clientId)}`, {
    method: "PUT",
    body,
  });

export function splitEntries(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

export function validateServiceClient(
  clientId: string,
  payload: ServiceClientPayload,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!clientId || clientId.length > 120 || /\s/.test(clientId))
    errors.clientId = "Escribe el client_id de Identity, sin espacios.";
  if (
    !payload.products.length ||
    payload.products.length > 100 ||
    payload.products.some((code) => code === "*" || code.length > 80)
  )
    errors.products =
      "Agrega códigos de productos concretos, por ejemplo, codigo_producto.";
  if (payload.organizationScope === "organizations") {
    const message = validateOrganizationIds(payload.organizationIds ?? []);
    if (message) errors.organizationIds = message;
  }
  const originsError = validateReturnOrigins(payload.allowedReturnOrigins);
  if (originsError) errors.allowedReturnOrigins = originsError;
  return errors;
}

export function mergeReturnOrigins(current: string[], draft: string): string[] {
  return [...new Set([...current, ...splitEntries(draft)])];
}

export function validateReturnOrigins(origins: string[]): string | undefined {
  if (
    !origins.length ||
    origins.length > 100 ||
    origins.some((origin) => {
      try {
        const url = new URL(origin);
        return (
          url.username !== "" ||
          url.password !== "" ||
          url.pathname !== "/" ||
          !!url.search ||
          !!url.hash ||
          origin.includes("*") ||
          !(
            url.protocol === "https:" ||
            (url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
          )
        );
      } catch {
        return true;
      }
    })
  )
    return "Agrega orígenes HTTPS sin rutas, credenciales ni comodines. En desarrollo se permite HTTP local.";
}

export function mergeOrganizationIds(current: string[], draft: string): string[] {
  return [...new Set([...current, ...splitEntries(draft)].map((id) => id.toLowerCase()))];
}

export function validateOrganizationIds(ids: string[]): string | undefined {
  if (!ids.length || ids.length > 1000 || ids.some((id) =>
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
  )) return "Agrega UUID válidos de las organizaciones permitidas.";
}
