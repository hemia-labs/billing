import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../../apps/web/src/lib/api";
import { activateProductPaypalConnection, setProductPaypalConnectionStatus, getProductPaypalConnection, listProductPaypalConnections, paypalConnectionSaveUrl, rotateProductPaypalCredentials, saveProductPaypalConnection, type ProductPaypalConnection } from "../../../apps/web/src/features/billing/integrations/payments/paypal-connection-api";
import { PaypalConnectionForm, preparePaypalConnection } from "../../../apps/web/src/features/billing/integrations/payments/paypal-connection-form";

import { PaypalCredentialRotationForm } from "../../../apps/web/src/features/billing/integrations/payments/paypal-credential-rotation-form";

const originalFetch = globalThis.fetch;
const connection: ProductPaypalConnection = { id: "connection-1", productId: "product-1", name: "Medsync", environment: "sandbox", clientId: "client-id", webhookId: "webhook-id", enabled: false, hasClientSecret: true, webhookPath: "/api/v1/billing/webhooks/paypal/connection-1", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z" };
const values = { name: " Medsync ", environment: "sandbox" as const, clientId: " client-id ", clientSecret: "", webhookId: " webhook-id " };
const draft = { ...connection, id: "draft-1", isDraft: true, webhookPath: "/api/v1/billing/webhooks/paypal/draft-1" };
const state = { connection, draft, source: "product", encryptionConfigured: true };
afterEach(() => { globalThis.fetch = originalFetch; });

describe("conexión PayPal por producto", () => {
  test("primera app se guarda sólo como borrador sin webhook, con secreto literal", () => {
    const { payload, errors } = preparePaypalConnection({ ...values, webhookId: "", clientSecret: " secret literal " }, null);
    expect(errors).toEqual({});
    expect(payload).toEqual({ name: "Medsync", environment: "sandbox", clientId: "client-id", webhookId: "", clientSecret: " secret literal " });
  });
  test("misma app conserva secreto sólo al omitirlo; cambio de app o entorno exige uno nuevo", () => {
    const unchanged = preparePaypalConnection(values, null, connection);
    expect(unchanged.errors).toEqual({});
    expect(unchanged.payload).not.toHaveProperty("clientSecret");
    expect(preparePaypalConnection({ ...values, clientId: "another-app" }, connection).errors.clientSecret).toBeDefined();
    expect(preparePaypalConnection({ ...values, environment: "live" }, connection).errors.clientSecret).toBeDefined();
    expect(preparePaypalConnection(values, { ...connection, hasClientSecret: false }).errors.clientSecret).toBeDefined();
  });
  test("borrador permite webhook vacío; campos vacíos y límites se validan antes de enviar", () => {
    expect(preparePaypalConnection({ ...values, webhookId: " " }, draft).errors).toEqual({});
    const errors = preparePaypalConnection({ ...values, name: " ", clientId: " ", clientSecret: "x".repeat(2049), webhookId: "x".repeat(256) }, null).errors;
    expect(Object.keys(errors).sort()).toEqual(["clientId", "clientSecret", "name", "webhookId"]);
  });
  test("formulario nunca precarga el secreto y sólo muestra webhook y activación después del primer guardado", () => {
    const render = (existing: ProductPaypalConnection | null, current: ProductPaypalConnection | null = null) => renderToStaticMarkup(createElement(PaypalConnectionForm, { draft: existing, current, productName: "Medsync", onSave: async () => {}, onCancel: () => {}, onActivate: () => {} }));
    const html = render(draft, connection);
    const secretInput = html.match(/<input\b[^>]*name="clientSecret"[^>]*>/)?.[0];
    expect(secretInput).toContain('type="password"');
    expect(secretInput).toContain('autoComplete="new-password"');
    expect(secretInput).toContain('value=""');
    expect(secretInput).not.toContain('required=""');
    expect(html).toContain("Deja este campo vacío para conservarlo");
    const first = render(null);
    expect(first).toContain("Guardar el borrador conserva la conexión vigente");
    expect(first).not.toContain('id="paypal-enabled"');
    expect(first).not.toContain('name="webhookId"');
    expect(first).not.toContain('id="paypal-webhook-url"');
    expect(html).not.toContain('id="paypal-enabled"');
    expect(html).toContain("Activar conexión");
    expect(html).toContain('name="webhookId"');
    expect(html).toContain(draft.webhookPath);
    const fromCurrent = render(null, connection);
    expect(fromCurrent).not.toContain(connection.webhookPath);
    expect(fromCurrent).not.toContain("Activar conexión");
    expect(first.match(/<input\b[^>]*name="clientSecret"[^>]*>/)?.[0]).toContain('required=""');
  });
  test("retomar borrador envía versión e identidad; nunca convierte guardar en activar", () => {
    const { payload } = preparePaypalConnection(values, draft, connection);
    expect(payload.draftId).toBe(draft.id);
    expect(payload.expectedUpdatedAt).toBe(draft.updatedAt);
    expect(payload).not.toHaveProperty("enabled");
    expect(preparePaypalConnection(values, null, connection).payload).not.toHaveProperty("draftId");
  });
  test("activación exige borrador guardado con webhook y queda bloqueada durante mutaciones", () => {
    const render = (saved: ProductPaypalConnection, busy = false) => renderToStaticMarkup(createElement(PaypalConnectionForm, { draft: saved, current: connection, productName: "Medsync", busy, onSave: async () => {}, onCancel: () => {}, onActivate: () => {} }));
    const activation = (html: string) => html.match(/<button[^>]*aria-describedby="paypal-activation-help"[^>]*>/)?.[0];
    expect(activation(render({ ...draft, webhookId: "" }))).toContain('disabled=""');
    expect(activation(render(draft))).not.toContain('disabled=""');
    const pending = render(draft, true);
    expect(activation(pending)).toContain('disabled=""');
    expect(pending.match(/<input[^>]*name="clientSecret"[^>]*>/)?.[0]).toContain('disabled=""');
  });
  test("activar es POST explícito con versiones de borrador y vigente", async () => {
    const fetchMock = mock(async () => Response.json({ ...state, draft: null }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const payload = { expectedUpdatedAt: draft.updatedAt, expectedCurrentConnectionId: connection.id, expectedCurrentUpdatedAt: connection.updatedAt };
    await activateProductPaypalConnection("product/1", "draft/1", payload);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/products/product%2F1/paypal-connections/draft%2F1/activate");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(String(options.body))).toEqual(payload);
    await activateProductPaypalConnection("product-1", draft.id, { expectedUpdatedAt: draft.updatedAt, expectedCurrentConnectionId: null, expectedCurrentUpdatedAt: null });
    const optionsWithoutCurrent = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(optionsWithoutCurrent.body))).toEqual({ expectedUpdatedAt: draft.updatedAt, expectedCurrentConnectionId: null, expectedCurrentUpdatedAt: null });
  });
  test("desactivar y reactivar vigente no guardan ni activan borrador", async () => {
    const fetchMock = mock(async () => Response.json(state));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    for (const enabled of [false, true]) {
      expect(await setProductPaypalConnectionStatus("product/1", "current/1", enabled)).toEqual(state);
      const [url, options] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
      expect(url).toEndWith("/products/product%2F1/paypal-connections/current%2F1/status");
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(String(options.body))).toEqual({ enabled });
    }
  });
  test("lectura usa sesión, señal de cancelación y no permite caché", async () => {
    const fetchMock = mock(async () => Response.json(state));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    expect(await getProductPaypalConnection("product/1", controller.signal)).toEqual(state);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/billing/console/catalog/products/product%2F1/paypal-connection");
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBe(controller.signal);
  });
  test("guardado sólo envía secreto en cuerpo PUT autenticado, sin redirecciones ni caché", async () => {
    const fetchMock = mock(async () => Response.json(state));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { payload } = preparePaypalConnection({ ...values, clientSecret: " private literal " }, connection);
    expect(await saveProductPaypalConnection("product-1", payload)).toEqual(state);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain("private");
    expect(options.method).toBe("PUT");
    expect(options.credentials).toBe("include");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    expect(JSON.parse(String(options.body))).toEqual(payload);
  });
  test("rechaza transporte inseguro antes de enviar credenciales", async () => {
    expect(() => paypalConnectionSaveUrl("http://billing.example.test/api/v1", "product-1")).toThrow("HTTPS");
    expect(() => paypalConnectionSaveUrl("https://user:password@billing.example.test/api/v1", "product-1")).toThrow("HTTPS");
    const originalWindow = globalThis.window;
    const fetchMock = mock(async () => Response.json(state));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: false } });
      await expect(saveProductPaypalConnection("product-1", values)).rejects.toThrow("página segura");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally { Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow }); }
  });
  test.each([400, 401, 403, 404, 409, 429, 503])("errores conservan status %s sin mostrar credenciales ni cuerpo del proveedor", async (status) => {
    globalThis.fetch = (async () => Response.json({ message: "secret-user-input", clientSecret: "secret-user-input" }, { status })) as typeof fetch;
    try {
      await saveProductPaypalConnection("product-1", values);
      throw new Error("Expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as Error).message).not.toContain("secret-user-input");
    }
  });
});

describe("mantenimiento de conexiones PayPal anteriores", () => {
  test("lee historial redactado por producto sin caché y con sesión", async () => {
    const history = { connections: [{ ...connection, isCurrent: false }], encryptionConfigured: true };
    const fetchMock = mock(async () => Response.json(history));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await listProductPaypalConnections("product/1")).toEqual(history);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/billing/console/catalog/products/product%2F1/paypal-connections");
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("include");
  });
  test("rota secreto literal en conexión concreta sin cambiar identidad ni asignación", async () => {
    const fetchMock = mock(async () => Response.json(state));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const payload = { clientSecret: " new literal ", webhookId: "new-webhook" };
    expect(await rotateProductPaypalCredentials("product/1", "connection/1", payload)).toEqual(state);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/billing/console/catalog/products/product%2F1/paypal-connections/connection%2F1");
    expect(options.method).toBe("PATCH");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    expect(options.credentials).toBe("include");
    expect(JSON.parse(String(options.body))).toEqual(payload);
    expect(url).not.toContain("literal");
  });
  test("rotación requiere secreto nuevo vacío por defecto y mantiene identidad fuera del formulario", () => {
    const html = renderToStaticMarkup(createElement(PaypalCredentialRotationForm, { connection, onSave: async () => {}, onCancel: () => {} }));
    const secret = html.match(/<input\b[^>]*name="clientSecret"[^>]*>/)?.[0];
    expect(secret).toContain('type="password"');
    expect(secret).toContain('required=""');
    expect(secret).toContain('value=""');
    expect(secret).toContain('autoComplete="new-password"');
    expect(html).not.toContain('name="clientId"');
    expect(html).not.toContain('name="environment"');
    expect(html).not.toContain('name="enabled"');
    expect(html).toContain("Déjalo vacío para conservar el ID actual");
  });
  test("rotación no muestra cuerpos sensibles en un error del backend", async () => {
    globalThis.fetch = (async () => Response.json({ message: "sensitive-secret" }, { status: 409 })) as typeof fetch;
    try {
      await rotateProductPaypalCredentials("product-1", "connection-1", { clientSecret: "sensitive-secret" });
      throw new Error("Expected conflict");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as Error).message).not.toContain("sensitive-secret");
    }
  });
});
