export const apiBaseUrl = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3015/api/v1"
).replace(/\/$/, "");
export const authBaseUrl = apiBaseUrl.replace(/\/api\/v\d+$/, "");

type ApiBody = BodyInit | Record<string, unknown> | unknown[] | null;

type ApiFetchOptions = Omit<RequestInit, "body" | "credentials"> & {
  body?: ApiBody;
};

type ApiErrorBody = {
  message?: unknown;
  error?: unknown;
  details?: unknown;
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
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
  url.searchParams.set("returnTo", returnTo);
  window.location.assign(url.toString());
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status === 401) return "Sesión expirada. Inicia sesión de nuevo.";
  if (error.status === 403) return "No tienes permiso para esta acción.";
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

  return new ApiError(response.status, message, body?.details);
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
