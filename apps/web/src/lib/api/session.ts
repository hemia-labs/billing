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

export function getSession(): Promise<Session> {
  return fetch(`${authBaseUrl}/auth/session`, {
    credentials: "include",
  }).then(async (response) => {
    if (!response.ok) {
      throw new ApiError(response.status, response.statusText || "Request failed");
    }

    return response.json() as Promise<Session>;
  });
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
  return response.json() as Promise<Session>;
}
