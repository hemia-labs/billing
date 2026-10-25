"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { Skeleton } from "@/components/zuno/skeleton";
import { Button } from "@/components/zuno/button";
import { ApiError, redirectToLogin } from "@/lib/api";
import { getSession, logout, selectOrganization, type Session } from "@/lib/api/session";

const SessionContext = createContext<Session | null>(null);

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [session, setSession] = useState<Session | null>();

  const [selectionError, setSelectionError] = useState("");
  const [selecting, setSelecting] = useState(false);

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

  if (session === undefined) {
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

  if (session === null) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-xs space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Sesión cerrada</h1>
            <p className="mt-1 text-sm text-muted-foreground">Inicia sesión para volver a Billing.</p>
          </div>
          <Button className="w-full" onClick={() => redirectToLogin()}>
            Iniciar sesión
          </Button>
        </div>
      </main>
    );
  }

  if (session.requiresOrganizationSelection) {
    return (
      <main className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-sm space-y-4 rounded-lg border bg-card p-5">
          <h1 className="text-lg font-semibold">Selecciona tu organización</h1>
          <p className="text-sm text-muted-foreground">Elige desde qué organización operar Billing.</p>
          {(session.organizations ?? []).map((organization) => (
            <Button key={organization.organizationId} className="w-full whitespace-normal" disabled={selecting}
              onClick={async () => {
                setSelecting(true);
                setSelectionError("");
                try {
                  setSession(await selectOrganization(organization.organizationId));
                } catch (error) {
                  if (error instanceof ApiError && error.status === 401) {
                    redirectToLogin();
                  } else {
                    setSelectionError(error instanceof ApiError && error.status === 429
                      ? "Espera un momento antes de intentar de nuevo."
                      : "No se pudo activar la organización. Actualiza la página o intenta de nuevo.");
                  }
                } finally {
                  setSelecting(false);
                }
              }}>
              {organization.name}
            </Button>
          ))}
          {selecting && <p role="status">Validando acceso…</p>}
          {selectionError && <p role="alert">{selectionError}</p>}
          {!session.organizations?.length && <p role="alert">No hay organizaciones disponibles.</p>}
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
  return session.permissions?.includes(permission) === true;
}

export function useHasPermission(permission: string): boolean {
  return hasPermission(useSession(), permission);
}

export { logout };
