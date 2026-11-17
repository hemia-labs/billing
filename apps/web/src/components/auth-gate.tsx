"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Skeleton } from "@/components/zuno/skeleton";
import { Button } from "@/components/zuno/button";
import { ApiError, authCallbackError, redirectToLogin, safeLoginReturnTo, type AuthCallbackError } from "@/lib/api";
import { getSession, logout, selectOrganization, type Session } from "@/lib/api/session";

const SessionContext = createContext<Session | null>(null);

export type AuthGateFailure = AuthCallbackError | "session_unavailable" | "rate_limited" | "session_failed";
export type AuthGateState = { status: "loading" } | { status: "authenticated"; session: Session } | { status: "blocked"; reason: AuthGateFailure };

export function startAuthSessionCheck({ callbackError, onState, onLogin, onAuthenticated }: {
  callbackError: AuthCallbackError | null;
  onState: (state: AuthGateState) => void;
  onLogin: () => void;
  onAuthenticated: () => void;
}) {
  const controller = new AbortController();
  void Promise.resolve().then(async () => {
    if (controller.signal.aborted) return;
    onState({ status: "loading" });
    try {
      const session = await getSession(controller.signal);
      if (controller.signal.aborted) return;
      onAuthenticated();
      onState({ status: "authenticated", session });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (cause instanceof ApiError && cause.status === 401 && !callbackError) { onLogin(); return; }
      const reason: AuthGateFailure = cause instanceof ApiError && cause.status === 401 && callbackError ? callbackError
        : cause instanceof ApiError && cause.status === 403 ? "access_denied"
        : cause instanceof ApiError && cause.status === 429 ? "rate_limited"
        : cause instanceof TypeError || cause instanceof DOMException && cause.name === "TimeoutError" || cause instanceof ApiError && cause.status >= 500 ? "session_unavailable"
        : "session_failed";
      onState({ status: "blocked", reason });
    }
  });
  return () => controller.abort();
}

const failureCopy: Record<AuthGateFailure, { title: string; description: string }> = {
  access_unavailable: { title: "Servicio de acceso no disponible", description: "No pudimos validar tu acceso a Billing. Intenta iniciar sesión de nuevo cuando el servicio esté disponible." },
  access_denied: { title: "Sin acceso a Billing", description: "Tu cuenta no tiene acceso a Billing. Revisa tus permisos con el administrador y vuelve a intentarlo." },
  auth_failed: { title: "No se pudo iniciar sesión", description: "El inicio de sesión no pudo completarse. Inténtalo de nuevo." },
  session_unavailable: { title: "No se pudo consultar la sesión", description: "El servicio no está disponible o no responde. Revisa la conexión y vuelve a intentarlo." },
  rate_limited: { title: "Demasiados intentos", description: "Espera un momento antes de volver a consultar la sesión." },
  session_failed: { title: "No se pudo validar la sesión", description: "No pudimos confirmar tu sesión de Billing. Intenta de nuevo." },
};

export function AuthGateFailureView({ reason, onRetry, onLogin, callbackFailure = false }: { reason: AuthGateFailure; onRetry: () => void; onLogin: () => void; callbackFailure?: boolean }) {
  const copy = failureCopy[reason];
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm space-y-4 rounded-lg border border-border bg-card p-5 shadow-sm">
        <div role="alert"><h1 className="text-lg font-semibold text-foreground">{copy.title}</h1><p className="mt-1 text-sm text-muted-foreground">{copy.description}</p></div>
        <Button className="w-full" onClick={callbackFailure ? onLogin : onRetry} type="button">{callbackFailure ? "Reintentar inicio de sesión" : "Reintentar"}</Button>
        {!callbackFailure && reason === "access_denied" ? <Button className="w-full" onClick={onLogin} type="button" variant="outline">Iniciar sesión de nuevo</Button> : null}
      </div>
    </main>
  );
}

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const [state, setState] = useState<AuthGateState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [callbackFailure, setCallbackFailure] = useState(false);
  const loginStarted = useRef(false);
  const login = useCallback(() => { if (!loginStarted.current) { loginStarted.current = true; setState({ status: "loading" }); redirectToLogin(); } }, []);
  const [selectionError, setSelectionError] = useState("");
  const [selecting, setSelecting] = useState(false);
  const setSession = (session: Session) => setState({ status: "authenticated", session });
  useEffect(() => startAuthSessionCheck({
    callbackError: authCallbackError(window.location.search),
    onState: (next) => {
      setState(next);
      setCallbackFailure(next.status === "blocked" && next.reason === authCallbackError(window.location.search));
    },
    onLogin: login,
    onAuthenticated: () => {
      if (!authCallbackError(window.location.search)) return;
      const current = window.location.pathname + window.location.search + window.location.hash;
      const clean = safeLoginReturnTo(current, window.location.origin);
      if (current !== clean) window.history.replaceState(window.history.state, "", clean);
    },
  }), [attempt, login]);

  if (state.status === "loading") return (
    <main className="grid min-h-screen place-items-center bg-background p-6" aria-label="Validando sesión">
      <div className="w-full max-w-xs space-y-3"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-4/5" /></div>
    </main>
  );
  if (state.status === "blocked") return <AuthGateFailureView callbackFailure={callbackFailure} onLogin={login} onRetry={() => setAttempt((value) => value + 1)} reason={state.reason} />;
  const session = state.session;

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
                    login();
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
