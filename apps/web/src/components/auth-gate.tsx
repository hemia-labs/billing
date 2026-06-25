"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, redirectToLogin } from "@/lib/api";
import { getSession, logout, type Session } from "@/lib/api/session";

const SessionContext = createContext<Session | null>(null);

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [session, setSession] = useState<Session | null>();

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch((error) => {
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setSession(null);
      });
  }, []);

  if (!session) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6" aria-label="Validando sesión">
        <div className="w-full max-w-xs space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </main>
    );
  }

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useSession must be used within AuthGate");
  return session;
}

export function hasPermission(session: Session, permission: string): boolean {
  const scopes = session.scopes;
  if (!scopes) return true;
  if (scopes.includes("*.*") || scopes.includes(permission)) return true;

  const [resource] = permission.split(".");
  return scopes.includes(`${resource}.*`);
}

export function useHasPermission(permission: string): boolean {
  return hasPermission(useSession(), permission);
}

export { logout };
