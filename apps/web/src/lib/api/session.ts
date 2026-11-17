import { ApiError, authBaseUrl } from "@/lib/api";

export type SessionUser = {
  ssoUserId: string;
  email: string;
  name: string;
};

export type Session = {
  authenticated: true;
  user: SessionUser;
  organizationId?: string;
  permissions?: string[];
  requiresOrganizationSelection?: boolean;
  organizations?: {
    organizationId: string;
    code: string;
    name: string;
  }[];
};

function sessionResponse(value: unknown): Session {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid session response");
  const data = value as Record<string, unknown>;
  if (data.authenticated === false) throw new ApiError(401, "Unauthenticated");
  if (data.authenticated !== true || !data.user || typeof data.user !== "object" || Array.isArray(data.user)) throw new Error("Invalid session response");
  const user = data.user as Record<string, unknown>;
  if (typeof user.ssoUserId !== "string" || !user.ssoUserId || typeof user.email !== "string" || typeof user.name !== "string") throw new Error("Invalid session response");
  if (data.organizationId !== undefined && typeof data.organizationId !== "string") throw new Error("Invalid session response");
  if (data.permissions !== undefined && (!Array.isArray(data.permissions) || !data.permissions.every((permission) => typeof permission === "string"))) throw new Error("Invalid session response");
  if (data.requiresOrganizationSelection !== undefined && typeof data.requiresOrganizationSelection !== "boolean") throw new Error("Invalid session response");
  if (data.organizations !== undefined && (!Array.isArray(data.organizations) || !data.organizations.every((item) => item && typeof item === "object" && typeof item.organizationId === "string" && typeof item.code === "string" && typeof item.name === "string"))) throw new Error("Invalid session response");
  if (!Array.isArray(data.permissions) || (data.requiresOrganizationSelection === true ? !Array.isArray(data.organizations) : typeof data.organizationId !== "string" || !data.organizationId)) throw new Error("Invalid session response");
  // Project only the public console session; never retain extra token or credential fields.
  return {
    authenticated: true,
    user: { ssoUserId: user.ssoUserId, email: user.email, name: user.name },
    ...(typeof data.organizationId === "string" ? { organizationId: data.organizationId } : {}),
    ...(Array.isArray(data.permissions) ? { permissions: data.permissions as string[] } : {}),
    ...(typeof data.requiresOrganizationSelection === "boolean" ? { requiresOrganizationSelection: data.requiresOrganizationSelection } : {}),
    ...(Array.isArray(data.organizations) ? { organizations: data.organizations.map((item) => ({ organizationId: item.organizationId as string, code: item.code as string, name: item.name as string })) } : {}),
  };
}

export async function getSession(signal?: AbortSignal): Promise<Session> {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 15_000);
  try {
    const response = await fetch(`${authBaseUrl}/auth/session`, { credentials: "include", cache: "no-store", redirect: "error", signal: controller.signal });
    controller.signal.throwIfAborted();
    if (!response.ok) throw new ApiError(response.status, "Session request failed");
    const data: unknown = await response.json();
    controller.signal.throwIfAborted();
    return sessionResponse(data);
  } catch (cause) {
    if (timedOut && !signal?.aborted) throw new DOMException("Session request timed out", "TimeoutError");
    throw cause;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

type LogoutResponse = {
  logoutUrl?: string;
};

export async function logout(): Promise<void> {
  const response = await fetch(`${authBaseUrl}/auth/logout`, {
    credentials: "include",
    method: "POST",
  });
  if (!response.ok) {
    throw new ApiError(response.status, response.statusText || "Logout failed");
  }

  const { logoutUrl } = (await response.json()) as LogoutResponse;
  if (!logoutUrl) throw new Error("Identity logout URL is missing");

  const identityResponse = await fetch(logoutUrl, {
    credentials: "include",
    method: "POST",
  });
  if (!identityResponse.ok) {
    throw new ApiError(
      identityResponse.status,
      identityResponse.statusText || "Identity logout failed",
    );
  }

  window.location.assign("/");
}

export async function selectOrganization(organizationId: string): Promise<Session> {
  const response = await fetch(`${authBaseUrl}/auth/organization`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) throw new ApiError(response.status, response.statusText);
  return sessionResponse(await response.json());
}
