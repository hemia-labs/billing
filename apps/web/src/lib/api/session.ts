import { apiFetch } from "@/lib/api";

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

export function logout(): void {
  apiFetch<{ logoutUrl?: string }>("/auth/logout", { method: "POST" })
    .then(({ logoutUrl }) => window.location.assign(logoutUrl ?? "/"))
    .catch(() => window.location.assign("/"));
}
