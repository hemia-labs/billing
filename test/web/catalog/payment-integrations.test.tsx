import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../../apps/web/src/lib/api";
import { legacyPaymentIntegrationHref, savedPaymentConnectionRows, loadPaymentConnectionRows, loadPaymentProducts, paymentIntegrationHref, paymentPanelSelection, type PaymentConnectionRow } from "../../../apps/web/src/features/billing/integrations/payments/payment-products";
import { visibleIntegrationTypes } from "../../../apps/web/src/features/billing/integrations/catalog/integration-catalog";
import { ProductPaymentSummaryView } from "../../../apps/web/src/features/billing/catalog/products/product-payment-summary";
import type { ProductPaypalConnectionState } from "../../../apps/web/src/features/billing/integrations/payments/paypal-connection-api";

import { PaypalConnectionsList } from "../../../apps/web/src/features/billing/integrations/payments/paypal-connections-list";
import IntegrationTypePage from "../../../apps/web/src/app/integrations/[type]/page";
import { PaymentProviderOverview } from "../../../apps/web/src/features/billing/integrations/payments/payment-provider-overview";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const product = (id: string) => ({ id, code: id, name: id, description: null, status: "active" as const });

describe("ubicación y selección de la integración PayPal", () => {
  test("carga todas las páginas del selector, incluyendo el último producto, y propaga cancelación", async () => {
    const fetchMock = mock(async (url: string) => {
      const page = Number(new URL(url).searchParams.get("page"));
      return Response.json({ items: page === 1 ? [product("first"), product("second")] : [product("last")], page, limit: 2, total: 3 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    const result = await loadPaymentProducts(controller.signal);
    expect(result.map((item) => item.id)).toEqual(["first", "second", "last"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    expect(calls.map(([url]) => new URL(url).searchParams.get("page"))).toEqual(["1", "2"]);
    expect(calls.every(([, options]) => options.signal === controller.signal)).toBe(true);
  });
  test("no devuelve un selector incompleto si falla una página posterior", async () => {
    let calls = 0;
    globalThis.fetch = (async () => ++calls === 1
      ? Response.json({ items: [product("first")], page: 1, limit: 1, total: 2 })
      : Response.json({ message: "Unavailable" }, { status: 503 })) as typeof fetch;
    await expect(loadPaymentProducts()).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(2);
  });
  test("selector vacío no solicita páginas adicionales", async () => {
    const fetchMock = mock(async () => Response.json({ items: [], page: 1, limit: 100, total: 0 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    expect(await loadPaymentProducts()).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("selección y enlaces guardan sólo el producto en URL, con caracteres codificados", () => {
    expect(paymentIntegrationHref()).toBe("/integrations/payments/paypal");
    const href = paymentIntegrationHref("product/1&clientSecret=hidden");
    const url = new URL(href, "https://billing.example.test");
    expect(url.pathname).toBe("/integrations/payments/paypal");
    expect([...url.searchParams.keys()]).toEqual(["product_id"]);
    expect(url.searchParams.get("product_id")).toBe("product/1&clientSecret=hidden");
  });
  test("legacy redirige sólo consultas reconocidas a rutas internas y descarta parámetros sensibles", async () => {
    expect(legacyPaymentIntegrationHref({})).toBeNull();
    expect(legacyPaymentIntegrationHref({ provider: "stripe", next: "https://evil.test" })).toBeNull();
    expect(legacyPaymentIntegrationHref({ product_id: ["one", "two"] })).toBeNull();
    expect(legacyPaymentIntegrationHref({ provider: "paypal", clientSecret: "discard-me" })).toBe("/integrations/payments/paypal?provider=paypal");
    const destination = legacyPaymentIntegrationHref({ product_id: "//evil.test/path&secret=hidden", provider: "paypal", clientSecret: "discard-me" });
    const url = new URL(destination!, "https://billing.test");
    expect(url.origin).toBe("https://billing.test");
    expect([...url.searchParams.keys()]).toEqual(["product_id"]);
    expect(url.searchParams.get("product_id")).toBe("//evil.test/path&secret=hidden");
    await expect(IntegrationTypePage({ params: Promise.resolve({ type: "payments" }), searchParams: Promise.resolve({ product_id: "product-1" }) })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/integrations/payments/paypal?product_id=product-1;307;" });
    await expect(IntegrationTypePage({ params: Promise.resolve({ type: "payments" }), searchParams: Promise.resolve({ provider: "paypal" }) })).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/integrations/payments/paypal?provider=paypal;307;" });
  });
  test("lector de catálogo ve PayPal sin permisos de otras integraciones", () => {
    expect(visibleIntegrationTypes(["billing.catalog.read"]).map((item) => item.key)).toEqual(["payments"]);
    expect(visibleIntegrationTypes(["billing.catalog.read"], true)).toEqual([]);
    expect(visibleIntegrationTypes(["billing.catalog.read", "billing.catalog.manage"], true).map((item) => item.key)).toEqual(["payments"]);
  });
  test("permisos de integraciones no conceden administrar PayPal y no cambian las otras cartas", () => {
    expect(visibleIntegrationTypes(["billing.integrations.read"]).map((item) => item.key)).toEqual(["oauth", "legal", "events"]);
    expect(visibleIntegrationTypes(["billing.integrations.manage"], true).map((item) => item.key)).toEqual(["oauth", "legal", "events"]);
    expect(visibleIntegrationTypes([])).toEqual([]);
    expect(visibleIntegrationTypes(["billing.catalog.manage"])).toEqual([]);
  });
});

describe("resumen de pagos en producto, sólo lectura", () => {
  const data: ProductPaypalConnectionState = { connection: {
    id: "connection-private", productId: "product-1", name: "private connection name", environment: "sandbox", clientId: "private-client-id", webhookId: "private-webhook-id", enabled: true, hasClientSecret: true, webhookPath: "/private-webhook-path", createdAt: "2026-11-11", updatedAt: "2026-11-11",
  }, draft: null, source: "product", encryptionConfigured: true };
  const render = (overrides: Partial<Parameters<typeof ProductPaymentSummaryView>[0]> = {}) => renderToStaticMarkup(createElement(ProductPaymentSummaryView, { productId: "product-1", canManage: true, data, error: "", onRetry: () => {}, ...overrides }));
  test("muestra proveedor y tipo real sin IDs, secretos, formularios ni controles de configuración", () => {
    const html = render();
    expect(html).toContain("PayPal");
    expect(html).toContain("Suscripciones recurrentes");
    expect(html).toContain("Habilitada para nuevas contrataciones");
    expect(html).toContain("Administrar en Integraciones");
    expect(html).toContain("/integrations/payments/paypal?product_id=product-1");
    for (const hidden of ["private-client-id", "private-webhook-id", "private-webhook-path", "Client secret", "Actualizar credenciales", "Editar conexión", "<input", "<form", "wallet", "tarjeta"])
      expect(html).not.toContain(hidden);
  });
  test("borrador pendiente no sustituye proveedor ni estado vigentes en producto", () => {
    const html = render({ data: { ...data, draft: { ...data.connection!, name: "Draft secret name", enabled: false, isDraft: true } } });
    expect(html).toContain("Habilitada para nuevas contrataciones");
    expect(html).not.toContain("Draft secret name");
    expect(html).not.toContain("Deshabilitada para nuevas contrataciones");
    const inherited = render({ data: { ...data, connection: null, source: "global", draft: data.connection } });
    expect(inherited).toContain("Configuración global heredada");
    expect(inherited).not.toContain("Habilitada para nuevas contrataciones");
  });
  test("global heredada no se presenta como activa ni como pago listo", () => {
    const html = render({ data: { connection: null, draft: null, source: "global", encryptionConfigured: false } });
    expect(html).toContain("Configuración global heredada");
    expect(html).toContain("Disponibilidad no verificada");
    expect(html).not.toContain("Habilitada para nuevas contrataciones");
    expect(html).not.toContain("Guardar");
  });
  test("conexión habilitada sin configuración de servidor no se presenta como disponible", () => {
    const html = render({ data: { ...data, encryptionConfigured: false } });
    expect(html).toContain("Configuración no disponible");
    expect(html).not.toContain("Habilitada para nuevas contrataciones");
    expect(html).not.toContain("clave");
  });
  test("lector no recibe botón de gestión y estado deshabilitado se conserva", () => {
    const html = render({ canManage: false, data: { ...data, connection: { ...data.connection!, enabled: false } } });
    expect(html).toContain("Ver en Integraciones");
    expect(html).not.toContain("Administrar en Integraciones");
    expect(html).toContain("Deshabilitada para nuevas contrataciones");
  });
  test("carga y error tienen estados accesibles y permiten recuperar la consulta", () => {
    const loading = render({ data: null });
    expect(loading).toContain('role="status"');
    expect(loading).toContain("Cargando proveedor de pago");
    const error = render({ error: "No se pudo cargar el proveedor." });
    expect(error).toContain('role="alert"');
    expect(error).toContain("Reintentar");
    expect(error).not.toContain("Suscripciones recurrentes");
  });
});

describe("proveedor primero y listado de conexiones", () => {
  test("mosaico abre PayPal sin producto y deep-link abre el panel con el producto elegido", () => {
    expect(paymentPanelSelection(new URLSearchParams())).toEqual({ productId: "", open: false });
    expect(paymentPanelSelection(new URLSearchParams("provider=paypal"))).toEqual({ productId: "", open: true });
    expect(paymentPanelSelection(new URLSearchParams("product_id=PRODUCT-A"))).toEqual({ productId: "product-a", open: true });
    expect(paymentPanelSelection(new URLSearchParams("provider=stripe"))).toEqual({ productId: "", open: false });
    expect(paymentPanelSelection(new URL(paymentIntegrationHref(), "https://billing.test").searchParams).open).toBe(false);
  });
  test("consulta metadatos secuencialmente sin disparar múltiples requests simultáneos", async () => {
    let active = 0, maximum = 0;
    const calls: string[] = [];
    globalThis.fetch = (async (url) => {
      calls.push(String(url));
      active++; maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return Response.json({ connection: null, draft: null, source: "global", encryptionConfigured: true });
    }) as typeof fetch;
    const rows = await loadPaymentConnectionRows([product("first"), product("second")]);
    expect(maximum).toBe(1);
    expect(rows.map((row) => row.product.id)).toEqual(["first", "second"]);
    expect(calls[0]).toEndWith("/products/first/paypal-connection");
    expect(calls[1]).toEndWith("/products/second/paypal-connection");
  });
  test("cancelar detiene el resto del listado y no convierte errores en herencia global", async () => {
    const controller = new AbortController();
    const fetchMock = mock(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(loadPaymentConnectionRows([product("first"), product("second")], controller.signal)).rejects.toThrow("Aborted");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  test("un producto fallido conserva error propio y los demás sí se consultan", async () => {
    globalThis.fetch = (async (url) => String(url).includes("first")
      ? Response.json({ message: "Forbidden" }, { status: 403 })
      : Response.json({ connection: null, draft: null, source: "global", encryptionConfigured: true })) as typeof fetch;
    const rows = await loadPaymentConnectionRows([product("first"), product("second")]);
    expect(rows[0].data).toBeNull();
    expect(rows[0].error).toContain("permiso");
    expect(rows[1].data?.source).toBe("global");
  });
  const renderList = (rows: PaymentConnectionRow[] | null, canManage = true, loading = false) => renderToStaticMarkup(createElement(PaypalConnectionsList, { rows, canManage, loading, onOpen: () => {}, onRetry: () => {} }));
  const connection = { id: "current", productId: "one", name: "App vigente", environment: "sandbox" as const, clientId: "current-client", webhookId: "current-webhook", enabled: true, hasClientSecret: true, webhookPath: "/current", createdAt: "2026-11-11", updatedAt: "2026-11-11" };
  const current = { connection, draft: null, source: "product" as const, encryptionConfigured: true };
  test("mosaico enlaza pantalla propia sin tabla, formularios ni consultas de productos", () => {
    const fetchMock = mock(async () => { throw new Error("Unexpected catalog request"); });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const html = renderToStaticMarkup(createElement(PaymentProviderOverview, { canManage: true }));
    expect(html).toContain('href="/integrations/payments/paypal"');
    expect(html).toContain("Configurar PayPal");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("Conexiones creadas");
    expect(html).not.toContain("Stripe");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(renderToStaticMarkup(createElement(PaymentProviderOverview, { canManage: false }))).toContain("Consultar PayPal");
  });
  test("lista sólo conexiones guardadas o errores; herencia global sola no es conexión creada", () => {
    const rows: PaymentConnectionRow[] = [
      { product: product("Inherited Only"), data: { connection: null, draft: null, source: "global", encryptionConfigured: true } },
      { product: product("Current Product"), data: current },
      { product: product("Draft Product"), data: { ...current, connection: null, source: "global", draft: { ...connection, id: "draft", name: "Borrador nuevo", isDraft: true } } },
      { product: product("Failed Product"), data: null, error: "No tienes permiso para esta acción." },
    ];
    expect(savedPaymentConnectionRows(rows).map((row) => row.product.id)).toEqual(["Current Product", "Draft Product", "Failed Product"]);
    const html = renderList(rows);
    expect(html).toContain("Conexiones creadas");
    expect(html).toContain("App vigente");
    expect(html).toContain("Borrador nuevo");
    expect(html).toContain("Borrador guardado");
    expect(html).toContain("Global sin verificar");
    expect(html).toContain("Failed Product");
    expect(html).toContain("Reintentar consultas");
    expect(html).not.toContain("Inherited Only");
    expect(html).not.toContain("current-client");
    expect(html).not.toContain("current-webhook");
  });
  test("borrador tiene distintivo separado sin reemplazar datos ni estado vigentes", () => {
    expect(renderList([{ product: product("one"), data: current }])).not.toContain("Borrador guardado");
    const html = renderList([{ product: product("one"), data: { ...current, draft: { ...connection, id: "draft", name: "Nueva app pendiente", environment: "live", enabled: false, isDraft: true } } }]);
    expect(html).toContain("Borrador guardado");
    expect(html).toContain("App vigente");
    expect(html).toContain("Sandbox");
    expect(html).toContain("Habilitada");
    expect(html).not.toContain("Nueva app pendiente");
    expect(html).not.toContain("Producción");
  });
  test("carga, fallo y vacío tienen estados distintos; sólo manager recibe crear/editar", () => {
    expect(renderList(null, true, true)).toContain("Cargando conexiones");
    const failed = renderList(null);
    expect(failed).toContain("No se pudieron consultar las conexiones");
    expect(failed).toContain("Reintentar consultas");
    expect(failed).not.toContain("Todavía no hay conexiones");
    const inherited: PaymentConnectionRow[] = [{ product: product("one"), data: { ...current, connection: null, source: "global" } }];
    expect(renderList(inherited)).toContain("Todavía no hay conexiones de PayPal creadas");
    expect(renderList(inherited)).toContain("Crear conexión");
    expect(renderList(inherited, false)).not.toContain("Crear conexión");
    const readonly = renderList([{ product: product("one"), data: current }], false);
    expect(readonly).toContain('aria-label="Ver PayPal de one"');
    expect(readonly).not.toContain("Editar");
    expect(renderList([{ product: product("one"), data: current }])).toContain('aria-label="Editar PayPal de one"');
  });
});
