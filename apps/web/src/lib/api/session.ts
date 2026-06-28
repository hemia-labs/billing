import { apiBaseUrl, apiFetch } from "@/lib/api";

export type SessionUser = {
  ssoUserId: string;
  email: string;
  name: string;
};

export type Session = {
  authenticated: true;
  user: SessionUser;
  scopes?: string[];
};

export function getSession(): Promise<Session> {
  return apiFetch<Session>("/auth/session");
}

type LogoutResponse = {
  logoutUrl?: string;
};

export async function logout(): Promise<void> {
  try {
    const out = (await fetch(`${apiBaseUrl}/auth/logout`, {
      credentials: "include",
      method: "POST",
    }).then((response) => response.json())) as LogoutResponse;

    if (out.logoutUrl) {
      await fetch(out.logoutUrl, {
        credentials: "include",
        method: "POST",
      });
    }
  } finally {
    window.location.assign("/");
  }
}
