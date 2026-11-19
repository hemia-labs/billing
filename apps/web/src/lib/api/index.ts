export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3015/api/v1"
).replace(/\/$/, "");
export const authBaseUrl = apiBaseUrl.replace(/\/api\/v\d+$/, "");

type ApiBody = BodyInit | Record<string, unknown> | unknown[] | null;

type ApiFetchOptions = Omit<RequestInit, "body" | "credentials"> & {
  body?: ApiBody;
};

type ApiErrorBody = {
  code?: unknown;
  message?: unknown;
  error?: unknown;
  details?: unknown;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const body = serializeBody(options.body, headers);
  const response = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    body,
    credentials: "include",
    headers,
  });

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function toQueryString(
  params: Record<string, string | number | boolean | null | undefined>,
): string {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      query.set(key, String(value));
    }
  });

  const text = query.toString();
  return text ? `?${text}` : "";
}

export function redirectToLogin(returnTo = currentReturnTo()): void {
  const url = new URL(`${authBaseUrl}/auth/login`);
  url.searchParams.set("returnTo", safeLoginReturnTo(returnTo, window.location.origin));
  window.location.assign(url.toString());
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return "Sesión expirada. Inicia sesión de nuevo.";
  if (error.status === 403) return "No tienes permiso para esta acción.";
  if (error.code === "BILLING_PROVIDER_PRICE_NOT_CONFIGURED") return "Falta configurar un ID de plan o precio PayPal activo para la conexión seleccionada. Configúralo antes de nuevas contrataciones.";
  if (error.code === "BILLING_PROVIDER_PRICE_SCOPE_CONFLICT") return "El mapping no coincide con la conexión PayPal seleccionada o ya existe uno activo para esa app. Revisa sus IDs y conexión.";
  if (error.status === 404) return "No se encontró el recurso solicitado.";
  if (error.status >= 500) return "El servicio no está disponible. Intenta de nuevo.";
  return error.message || fallback;
}

function serializeBody(
  body: ApiBody | undefined,
  headers: Headers,
): BodyInit | null | undefined {
  if (body === undefined || body === null) return body;

  if (
    typeof body === "string" ||
    body instanceof FormData ||
    body instanceof URLSearchParams ||
    body instanceof Blob ||
    body instanceof ArrayBuffer
  ) {
    return body;
  }

  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return JSON.stringify(body);
}

async function toApiError(response: Response): Promise<ApiError> {
  const body = await readErrorBody(response);
  const rawMessage = body?.message ?? body?.error;
  const message = Array.isArray(rawMessage)
    ? rawMessage.join(", ")
    : typeof rawMessage === "string"
      ? rawMessage
      : response.statusText || "Request failed";

  return new ApiError(response.status, message, body?.details, typeof body?.code === "string" ? body.code : undefined);
}

async function readErrorBody(response: Response): Promise<ApiErrorBody | null> {
  try {
    return (await response.json()) as ApiErrorBody;
  } catch {
    return null;
  }
}

function currentReturnTo(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

export type AuthCallbackError = "access_unavailable" | "access_denied" | "auth_failed";

export function authCallbackError(search: string): AuthCallbackError | null {
  return new URLSearchParams(search).getAll("error").find((value): value is AuthCallbackError => value === "access_unavailable" || value === "access_denied" || value === "auth_failed") ?? null;
}

export function safeLoginReturnTo(returnTo: string, origin: string): string {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//") || returnTo.split(/[?#]/, 1)[0].includes("\\")) return "/";
  try {
    const url = new URL(returnTo, origin);
    if (url.origin !== origin) return "/";
    // Keep unrelated query parameters, including their original encoding and repeated values.
    const query = url.search.slice(1).split("&").filter((part) => !authCallbackError(part)).join("&");
    return url.pathname + (query ? "?" + query : "") + url.hash;
  } catch { return "/"; }
}
