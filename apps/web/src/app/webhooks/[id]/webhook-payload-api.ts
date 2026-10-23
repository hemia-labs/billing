import { ApiError, apiBaseUrl } from "@/lib/api";

export function payloadDownloadUrl(baseUrl: string, id: string): URL {
  const endpoint = new URL(`${baseUrl}/billing/console/webhooks/${encodeURIComponent(id)}/payload/download`);
  const localDevelopment = endpoint.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname) &&
    process.env.NODE_ENV !== "production";
  if ((endpoint.protocol !== "https:" && !localDevelopment) || endpoint.username || endpoint.password) {
    throw new Error("La descarga con contraseña requiere una conexión HTTPS.");
  }
  return endpoint;
}

export async function requestWebhookPayload(id: string, password: string, reason: string, signal?: AbortSignal): Promise<Blob> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("La descarga con contraseña requiere una página segura.");
  }
  const response = await fetch(payloadDownloadUrl(apiBaseUrl, id).toString(), {
    method: "POST",
    redirect: "error",
    credentials: "include",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ password, reason }),
    signal,
  });
  if (!response.ok) throw new ApiError(response.status, payloadDownloadError(response.status));
  if (!response.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) {
    throw new Error("No se recibió un archivo JSON válido.");
  }
  return response.blob();
}

export function payloadDownloadError(status: number): string {
  if (status === 401) return "Sesión expirada. Inicia sesión de nuevo.";
  if (status === 403) return "No se pudo autorizar la descarga. Verifica tu contraseña y tus permisos.";
  if (status === 429) return "Demasiados intentos. Espera unos minutos antes de intentar de nuevo.";
  if (status === 404) return "No se encontró este webhook.";
  if (status >= 500) return "El servicio de descarga no está disponible. Intenta de nuevo más tarde.";
  return "No se pudo descargar el archivo. Revisa los datos e intenta de nuevo.";
}

export function saveWebhookPayload(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  try {
    link.href = url;
    link.download = "webhook-payload.json";
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
