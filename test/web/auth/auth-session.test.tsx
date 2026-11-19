import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuthGate, AuthGateFailureView, startAuthSessionCheck, type AuthGateState } from "../../../apps/web/src/components/auth-gate";
import { ApiError, authCallbackError, redirectToLogin, safeLoginReturnTo, type AuthCallbackError } from "../../../apps/web/src/lib/api";
import { getSession, selectOrganization } from "../../../apps/web/src/lib/api/session";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalSetTimeout = globalThis.setTimeout;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});
const session = { authenticated: true, user: { ssoUserId: "user-1", email: "operator@example.test", name: "Operator" }, organizationId: "org-1", permissions: ["billing.catalog.read"] };
const tick = () => new Promise((resolve) => originalSetTimeout(resolve, 0));
function check(callbackError: AuthCallbackError | null) {
  const states: AuthGateState[] = [];
  const onLogin = mock(() => {});
  const onAuthenticated = mock(() => {});
  const stop = startAuthSessionCheck({ callbackError, onState: (state) => states.push(state), onLogin, onAuthenticated });
  return { states, onLogin, onAuthenticated, stop };
}
function firstButton(node: ReactNode): { onClick: () => void } | undefined {
  if (Array.isArray(node)) return node.map(firstButton).find(Boolean);
  if (!isValidElement<{ onClick?: () => void; children?: ReactNode }>(node)) return;
  if (node.props.onClick) return { onClick: node.props.onClick };
  return firstButton(node.props.children);
}

describe("retorno seguro del callback", () => {
  test("sólo reconoce códigos cerrados y preserva errores ajenos", () => {
    expect(authCallbackError("?error=access_unavailable")).toBe("access_unavailable");
    expect(authCallbackError("?error=access_denied")).toBe("access_denied");
    expect(authCallbackError("?error=auth_failed")).toBe("auth_failed");
    expect(authCallbackError("?error=custom&error=access_unavailable")).toBe("access_unavailable");
    expect(authCallbackError("?error=unknown_secret&message=auth_failed")).toBeNull();
    expect(authCallbackError("?error=AUTH_FAILED")).toBeNull();
    const path = "/integrations/payments/paypal?product_id=abc&error=access_unavailable&tab=a%20b&tab=two&error=custom#mapping";
    expect(safeLoginReturnTo(path, "https://billing.test")).toBe("/integrations/payments/paypal?product_id=abc&tab=a%20b&tab=two&error=custom#mapping");
    expect(safeLoginReturnTo("/products?error=custom&filter=a\\b#keep\\fragment", "https://billing.test")).toBe("/products?error=custom&filter=a\\b#keep\\fragment");
    expect(safeLoginReturnTo("/products?%65rror=auth_failed&product_id=one&error=access_denied#price", "https://billing.test")).toBe("/products?product_id=one#price");
    expect(safeLoginReturnTo("/?error=unknown", "https://billing.test")).toBe("/?error=unknown");
  });
  test.each(["https://evil.test/path", "//evil.test/path", "/\\evil.test/path", "javascript:alert(1)", "relative/path", "/\n/evil.test/path"])("rechaza retorno externo o ambiguo: %s", (path) => {
    expect(safeLoginReturnTo(path, "https://billing.test")).toBe("/");
  });
  test("login manual usa origen de auth fijo y returnTo interno limpio", () => {
    const assign = mock(() => {});
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { origin: "https://billing.test", pathname: "/products", search: "?product_id=one&error=access_unavailable", hash: "#price", assign } } });
    redirectToLogin();
    const destination = new URL(assign.mock.calls[0][0]);
    expect(destination.pathname).toBe("/auth/login");
    expect(destination.searchParams.get("returnTo")).toBe("/products?product_id=one#price");
    redirectToLogin("//evil.test/path?error=auth_failed");
    expect(new URL(assign.mock.calls[1][0]).searchParams.get("returnTo")).toBe("/");
  });
});

describe("consulta de sesión", () => {
  test("usa cookies, no-store y timeout cancelable; proyecta sólo campos públicos", async () => {
    const fetchMock = mock(async () => Response.json({ ...session, accessToken: "secret-token", user: { ...session.user, refreshToken: "secret-refresh" } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    const result = await getSession(controller.signal);
    expect(result).toEqual(session);
    expect(result).not.toHaveProperty("accessToken");
    expect(result.user).not.toHaveProperty("refreshToken");
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/auth/session");
    expect(request.credentials).toBe("include");
    expect(request.cache).toBe("no-store");
    expect(request.redirect).toBe("error");
    expect(request.signal).toBeInstanceOf(AbortSignal);
    expect(request.headers).toBeUndefined();
  });
  test("cancela fetch en cleanup y no inicia request con señal ya abortada", async () => {
    const fetchMock = mock((_url: unknown, request: RequestInit) => new Promise<Response>((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true })));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    const pending = getSession(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(getSession(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("timeout aborta transporte y se diferencia de una sesión ausente", async () => {
    let budget = 0;
    globalThis.setTimeout = ((handler: TimerHandler, delay?: number) => { budget = Number(delay); return originalSetTimeout(handler, 0); }) as typeof setTimeout;
    globalThis.fetch = ((_url, request) => new Promise<Response>((_resolve, reject) => request?.signal?.addEventListener("abort", () => reject(request.signal?.reason), { once: true }))) as typeof fetch;
    await expect(getSession()).rejects.toMatchObject({ name: "TimeoutError" });
    expect(budget).toBe(15_000);
  });
  test.each([401, 403, 429, 503])("preserva HTTP %s sin leer ni mostrar respuesta cruda", async (status) => {
    globalThis.fetch = (async () => Response.json({ message: "private-server-details" }, { status })) as typeof fetch;
    try { await getSession(); throw new Error("Expected failure"); } catch (cause) { expect(cause).toBeInstanceOf(ApiError); expect((cause as ApiError).status).toBe(status); expect((cause as Error).message).not.toContain("private-server-details"); }
  });
  test("selección de organización conserva contrato y también valida la sesión recibida", async () => {
    const selection = { authenticated: true, user: session.user, requiresOrganizationSelection: true, organizations: [{ organizationId: "org-1", code: "medsync", name: "Medsync" }], permissions: [] };
    globalThis.fetch = (async () => Response.json(selection)) as typeof fetch;
    expect(await getSession()).toEqual(selection);
    globalThis.fetch = (async () => Response.json(session)) as typeof fetch;
    expect(await selectOrganization("org-1")).toEqual(session);
    globalThis.fetch = (async () => Response.json({ authenticated: true, user: session.user })) as typeof fetch;
    await expect(selectOrganization("org-1")).rejects.toThrow("Invalid session response");
  });
});

describe("orquestación real usada por el efecto AuthGate", () => {
  test.each(["access_unavailable", "access_denied", "auth_failed"] as const)("callback %s +401 bloquea auto-login y muestra estado recuperable", async (error) => {
    globalThis.fetch = (async () => Response.json({}, { status: 401 })) as typeof fetch;
    const run = check(error);
    await tick();
    expect(run.states).toEqual([{ status: "loading" }, { status: "blocked", reason: error }]);
    expect(run.onLogin).not.toHaveBeenCalled();
    expect(run.onAuthenticated).not.toHaveBeenCalled();
    run.stop();
  });
  test("401 sin marcador conserva un auto-login; cleanup StrictMode impide el primero duplicado", async () => {
    const fetchMock = mock(async () => Response.json({}, { status: 401 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const first = check(null); first.stop();
    const second = check(null);
    await tick();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.states).toEqual([]);
    expect(first.onLogin).not.toHaveBeenCalled();
    expect(second.onLogin).toHaveBeenCalledTimes(1);
    expect(second.states).toEqual([{ status: "loading" }]);
    second.stop();
  });
  test("respuesta vieja tras cleanup no actualiza estado ni redirige", async () => {
    let complete!: (response: Response) => void;
    globalThis.fetch = (() => new Promise<Response>((resolve) => { complete = resolve; })) as typeof fetch;
    const run = check(null);
    await tick();
    run.stop(); complete(Response.json(session)); await tick();
    expect(run.states).toEqual([{ status: "loading" }]);
    expect(run.onAuthenticated).not.toHaveBeenCalled();
    expect(run.onLogin).not.toHaveBeenCalled();
  });
  test.each([403, 429, 503])("HTTP %s conserva recuperación sin auto-login, incluso al reintentar", async (status) => {
    const fetchMock = mock(async () => Response.json({ message: "raw-secret" }, { status }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    for (let attempt = 0; attempt < 2; attempt++) {
      const run = check(null); await tick();
      expect(run.states.at(-1)).toEqual({ status: "blocked", reason: status === 403 ? "access_denied" : status === 429 ? "rate_limited" : "session_unavailable" });
      expect(run.onLogin).not.toHaveBeenCalled(); run.stop();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  test("error de red se recupera con nueva consulta y sesión válida prevalece sobre marca antigua", async () => {
    globalThis.fetch = (async () => { throw new TypeError("private-network-error"); }) as typeof fetch;
    const failed = check("access_unavailable"); await tick();
    expect(failed.states.at(-1)).toEqual({ status: "blocked", reason: "session_unavailable" });
    expect(failed.onLogin).not.toHaveBeenCalled(); failed.stop();
    globalThis.fetch = (async () => Response.json(session)) as typeof fetch;
    const recovered = check("access_unavailable"); await tick();
    expect(recovered.states.at(-1)).toEqual({ status: "authenticated", session });
    expect(recovered.onAuthenticated).toHaveBeenCalledTimes(1);
    expect(recovered.onLogin).not.toHaveBeenCalled(); recovered.stop();
  });
  test.each([{}, { authenticated: true }, { authenticated: true, user: session.user }, { ...session, permissions: "admin" }, { ...session, user: { name: "x" } }])("200 malformado nunca abre UI protegida", async (body) => {
    globalThis.fetch = (async () => Response.json(body)) as typeof fetch;
    const run = check(null); await tick();
    expect(run.states.at(-1)).toEqual({ status: "blocked", reason: "session_failed" });
    expect(run.onAuthenticated).not.toHaveBeenCalled(); expect(run.onLogin).not.toHaveBeenCalled(); run.stop();
  });
  test("200 authenticated:false se trata como ausencia de sesión y respeta bloqueo callback", async () => {
    globalThis.fetch = (async () => Response.json({ authenticated: false })) as typeof fetch;
    const run = check("auth_failed"); await tick();
    expect(run.states.at(-1)).toEqual({ status: "blocked", reason: "auth_failed" });
    expect(run.onAuthenticated).not.toHaveBeenCalled(); expect(run.onLogin).not.toHaveBeenCalled(); run.stop();
  });
});

describe("UI de recuperación de autenticación", () => {
  test("SSR es determinista y no consulta sesión ni renderiza contenido protegido", () => {
    const fetchMock = mock(async () => Response.json(session)); globalThis.fetch = fetchMock as unknown as typeof fetch;
    const html = renderToStaticMarkup(createElement(AuthGate, null, createElement("div", null, "Protected content")));
    expect(html).toContain("Validando sesión"); expect(html).not.toContain("Protected content"); expect(fetchMock).not.toHaveBeenCalled();
  });
  test("botón callback inicia login manual; recuperación 503 vuelve a consulta, sin OAuth", () => {
    const onRetry = mock(() => {}), onLogin = mock(() => {});
    firstButton(AuthGateFailureView({ reason: "access_unavailable", callbackFailure: true, onRetry, onLogin }))!.onClick();
    expect(onLogin).toHaveBeenCalledTimes(1); expect(onRetry).not.toHaveBeenCalled();
    firstButton(AuthGateFailureView({ reason: "session_unavailable", onRetry, onLogin }))!.onClick();
    expect(onRetry).toHaveBeenCalledTimes(1); expect(onLogin).toHaveBeenCalledTimes(1);
    const denied = renderToStaticMarkup(createElement(AuthGateFailureView, { reason: "access_denied", onRetry, onLogin }));
    expect(denied).toContain("Sin acceso a Billing"); expect(denied).toContain('role="alert"');
    expect(denied).not.toContain("access_denied"); expect(denied).not.toContain("raw-secret");
    expect(renderToStaticMarkup(createElement(AuthGateFailureView, { reason: "auth_failed", callbackFailure: true, onRetry, onLogin }))).toContain("No se pudo iniciar sesión");
  });
});
