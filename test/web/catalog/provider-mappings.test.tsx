import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError, apiErrorMessage } from "../../../apps/web/src/lib/api";
import { addAddonProviderPrice, addPlanProviderPrice, listAddonProviderPrices, setAddonProviderPriceStatus, setPlanProviderPriceStatus, type CatalogPlanPrice, type CatalogProviderPrice } from "../../../apps/web/src/features/billing/catalog/catalog-api";
import { ProviderConnectionField, providerConnectionLabel, type ProviderConnectionOptions } from "../../../apps/web/src/features/billing/catalog/provider-connection-options";
import { ProviderMappingForm, prepareProviderMapping, validatePlanProviderMappings } from "../../../apps/web/src/features/billing/catalog/provider-mapping-form";
import { ProviderMappings, providerMappingError } from "../../../apps/web/src/features/billing/catalog/provider-mappings";
import { PlanForm, pricePayload } from "../../../apps/web/src/features/billing/catalog/plans/plan-form";
import { AddonForm, changeAddonProvider } from "../../../apps/web/src/features/billing/catalog/addons/addon-form";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const app = (id: string, isCurrent = false) => ({ id, productId: "product-1", name: "App " + id, environment: "sandbox" as const, clientId: "private-client-id", webhookId: "private-webhook-id", enabled: true, hasClientSecret: true, webhookPath: "/private-hook", createdAt: "2026-11-11", updatedAt: "2026-11-11", isCurrent, isDraft: false });
const options: ProviderConnectionOptions = { data: { connections: [app("A"), app("B", true), { ...app("draft"), isDraft: true }], encryptionConfigured: true }, error: "", loading: false, retry: () => {} };
const mapping = (id: string, connection = id): CatalogProviderPrice => ({ id, provider: "paypal", connectionScope: "connection", providerConnectionId: connection, providerProductId: "product-remote-" + id, providerPriceId: "P-" + id, providerMetadata: {}, status: "active" });
const price: CatalogPlanPrice = { id: "price-1", code: "month-mxn", amount: "10.00", currency: "MXN", billingInterval: "month", billingIntervalCount: 1, status: "active", providerPrices: [mapping("A"), mapping("B")] };

describe("mappings por conexión: contrato y conservación", () => {
  test("clonar precio conserva A y B, IDs, ámbitos y metadatos sin mutar la versión anterior", () => {
    const original = JSON.stringify(price);
    const payload = pricePayload(price);
    expect(payload.providerPrices.map((item) => [item.connectionScope, item.providerConnectionId, item.providerPriceId])).toEqual([["connection", "A", "P-A"], ["connection", "B", "P-B"]]);
    expect(validatePlanProviderMappings([payload])).toBeNull();
    expect(JSON.stringify(price)).toBe(original);
    expect(payload.providerPrices).not.toBe(price.providerPrices);
  });
  test("legacy sin asignar nunca se convierte a global y exige elección al clonar", () => {
    const payload = pricePayload({ ...price, providerPrices: [{ ...mapping("legacy"), connectionScope: "unassigned", providerConnectionId: null }] });
    expect(payload.providerPrices[0].connectionScope).toBe("unassigned");
    expect(validatePlanProviderMappings([payload])).toContain("Precio month-mxn, vinculación 1");
    expect(validatePlanProviderMappings([payload])).toContain("Selecciona explícitamente");
    expect(validatePlanProviderMappings([{ ...payload, providerPrices: [{ ...payload.providerPrices[0], connectionScope: "global" }] }])).toBeNull();
  });
  test("permite A+B activos; evita duplicados activos en la misma app y permite reemplazo archivado", () => {
    const payload = pricePayload(price);
    expect(validatePlanProviderMappings([payload])).toBeNull();
    const duplicate = { ...payload, providerPrices: [payload.providerPrices[0], { ...payload.providerPrices[1], providerConnectionId: "A" }] };
    expect(validatePlanProviderMappings([duplicate])).toContain("un plan activo vinculado");
    expect(validatePlanProviderMappings([{ ...duplicate, providerPrices: [{ ...duplicate.providerPrices[0], status: "archived" }, duplicate.providerPrices[1]] }])).toBeNull();
  });
  test("clonar legacy no PayPal también exige Global explícito y no ofrece apps PayPal", () => {
    const copied = pricePayload({ ...price, providerPrices: [{ ...mapping("stripe"), provider: "stripe", connectionScope: "unassigned", providerConnectionId: null }] });
    expect(validatePlanProviderMappings([copied])).toContain("Precio month-mxn, vinculación 1");
    expect(copied.providerPrices[0].connectionScope).toBe("unassigned");
    const explicit = { ...copied, providerPrices: copied.providerPrices.map((mapping) => ({ ...mapping, connectionScope: "global" as const })) };
    expect(validatePlanProviderMappings([explicit])).toBeNull();
    const html = renderToStaticMarkup(createElement(ProviderConnectionField, { provider: "stripe", binding: { connectionScope: "unassigned", providerConnectionId: null }, options: { ...options, error: "PayPal unavailable", loading: true }, id: "global-scope", onChange: () => {} }));
    expect(html).toContain("Ámbito de la vinculación");
    expect(html).toContain("Elige Global");
    expect(html).not.toContain("PayPal");
    expect(html).not.toContain("App A");
    expect(html).not.toContain("App B");
    expect(html).not.toContain('disabled=""');
    const chosen = renderToStaticMarkup(createElement(ProviderConnectionField, { provider: "stripe", binding: { connectionScope: "global", providerConnectionId: null }, options, id: "global-chosen", onChange: () => {} }));
    expect(chosen).toContain("Global");
    expect(chosen).not.toContain("Global heredada");
    const form = renderToStaticMarkup(createElement(ProviderMappingForm, { provider: "stripe", options, onSave: async () => {}, onCancel: () => {} }));
    expect(form).not.toContain("PayPal");
    expect(form).toContain("ID del precio en el proveedor");
  });
  test("append exige scope e ID remoto explícitos, normaliza IDs y nunca incluye secretos", () => {
    const values = { provider: "paypal" as const, providerPriceId: " P-NEW ", providerProductId: " remote-product ", connectionScope: "connection" as const, providerConnectionId: "B" };
    const result = prepareProviderMapping(values);
    expect(result.payload).toEqual({ provider: "paypal", connectionScope: "connection", providerConnectionId: "B", providerPriceId: "P-NEW", providerProductId: "remote-product", status: "active" });
    expect(prepareProviderMapping({ ...values, connectionScope: "unassigned" }).error).toContain("Selecciona");
    expect(prepareProviderMapping({ ...values, providerConnectionId: null }).error).toContain("Selecciona");
    expect(prepareProviderMapping({ ...values, providerPriceId: " " }).error).toContain("ID");
    expect(prepareProviderMapping({ ...values, providerPriceId: "x".repeat(151) }).error).toBeDefined();
    expect(prepareProviderMapping({ ...values, providerProductId: "x".repeat(151) }).error).toBeDefined();
    expect(prepareProviderMapping({ ...values, connectionScope: "global", providerConnectionId: null }).payload?.providerConnectionId).toBeNull();
  });
  test.each(["plan", "addon"] as const)("append %s envía sólo nuevo mapping por POST, estado usa PATCH separado", async (kind) => {
    const fetchMock = mock(async () => Response.json(mapping("new", "B")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const payload = prepareProviderMapping({ provider: "paypal", connectionScope: "connection", providerConnectionId: "B", providerPriceId: "P-B", providerProductId: "" }).payload!;
    await (kind === "plan" ? addPlanProviderPrice("resource/1", payload) : addAddonProviderPrice("resource/1", payload));
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith(kind === "plan" ? "/catalog/plan-prices/resource%2F1/provider-prices" : "/catalog/addons/resource%2F1/provider-prices");
    expect(request.method).toBe("POST");
    expect(request.credentials).toBe("include");
    expect(JSON.parse(String(request.body))).toEqual(payload);
    expect(JSON.parse(String(request.body))).not.toHaveProperty("id");
    await (kind === "plan" ? setPlanProviderPriceStatus("mapping/1", "archived") : setAddonProviderPriceStatus("mapping/1", "archived"));
    const [statusUrl, statusRequest] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(statusUrl).toEndWith(kind === "plan" ? "/catalog/provider-prices/mapping%2F1/status" : "/catalog/addon-provider-prices/mapping%2F1/status");
    expect(statusRequest.method).toBe("PATCH");
    expect(JSON.parse(String(statusRequest.body))).toEqual({ status: "archived" });
  });
  test("historial addon usa sesión, no cache y cancelación", async () => {
    const fetchMock = mock(async () => Response.json([mapping("A"), mapping("B")]));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    expect(await listAddonProviderPrices("addon/1", controller.signal)).toHaveLength(2);
    const [url, request] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/catalog/addons/addon%2F1/provider-prices");
    expect(request.cache).toBe("no-store");
    expect(request.signal).toBe(controller.signal);
  });
  test("preserva sólo código string y status; traducción controlada nunca muestra cuerpo crudo", async () => {
    for (const code of ["BILLING_PROVIDER_PRICE_NOT_CONFIGURED", "BILLING_PROVIDER_PRICE_SCOPE_CONFLICT", "UNKNOWN_CODE", { secret: "secret-input" }, 123]) {
      globalThis.fetch = (async () => Response.json({ code, message: "raw-provider-secret-input", clientSecret: "secret-input" }, { status: 409 })) as typeof fetch;
      try {
        await setPlanProviderPriceStatus("mapping", "archived");
        throw new Error("Expected failure");
      } catch (cause) {
        expect(cause).toBeInstanceOf(ApiError);
        const error = cause as ApiError;
        expect(error.status).toBe(409);
        expect(error.code).toEqual(typeof code === "string" ? code : undefined);
        expect(error).not.toHaveProperty("clientSecret");
        expect(error).not.toHaveProperty("response");
        expect(providerMappingError(error)).not.toContain("secret-input");
        expect(providerMappingError(error)).not.toContain("UNKNOWN_CODE");
        if (code === "BILLING_PROVIDER_PRICE_NOT_CONFIGURED") expect(apiErrorMessage(error, "safe")).toContain("Falta configurar");
        if (code === "BILLING_PROVIDER_PRICE_SCOPE_CONFLICT") expect(apiErrorMessage(error, "safe")).toContain("conexión PayPal seleccionada");
      }
    }
    const details = { field: "name" };
    expect(new ApiError(400, "message", details).details).toBe(details);
    expect(new ApiError(400, "message", details).code).toBeUndefined();
  });
  test.each([400, 401, 403, 404, 409, 429, 503])("conserva error %s para sesión, permisos, conflicto y recuperación", async (status) => {
    globalThis.fetch = (async () => Response.json({ message: "Backend error" }, { status })) as typeof fetch;
    await expect(setPlanProviderPriceStatus("id", "archived")).rejects.toMatchObject({ status });
    const message = providerMappingError(new ApiError(status, "Backend error"));
    expect(message).toBeTruthy();
    if (status === 409) expect(message).toContain("archiva");
    if (status === 429) expect(message).toContain("Espera");
  });
});

describe("UI de mappings y conexión", () => {
  test("selector ofrece global, vigente y anterior; no drafts ni credenciales", () => {
    const html = renderToStaticMarkup(createElement(ProviderConnectionField, { binding: { connectionScope: "connection", providerConnectionId: "A" }, options, id: "scope", onChange: () => {} }));
    expect(html).toContain("App A");
    expect(html).toContain("Anterior");
    expect(providerConnectionLabel({ connectionScope: "connection", providerConnectionId: "B" }, options.data)).toContain("Vigente");
    expect(providerConnectionLabel({ connectionScope: "global", providerConnectionId: null }, options.data)).toBe("Global heredada");
    expect(providerConnectionLabel({ connectionScope: "unassigned", providerConnectionId: null }, options.data)).toContain("Sin asignar");
    for (const secret of ["private-client-id", "private-webhook-id", "private-hook", "App draft", "Client secret"])
      expect(html).not.toContain(secret);
  });
  test("selector carga y error recuperable deshabilitan configuración", () => {
    const render = (next: ProviderConnectionOptions) => renderToStaticMarkup(createElement(ProviderConnectionField, { binding: { connectionScope: "unassigned", providerConnectionId: null }, options: next, id: "scope", onChange: () => {} }));
    expect(render({ ...options, loading: true })).toContain("Cargando conexiones");
    const failed = render({ ...options, error: "No tienes permiso." });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Reintentar");
    expect(failed).toContain('disabled=""');
  });
  test("detalle conserva filas A/B inmutables y oculta acciones de gestión a lector", () => {
    const render = (canManage: boolean) => renderToStaticMarkup(createElement(ProviderMappings, { kind: "plan", resourceId: price.id, initialMappings: price.providerPrices, options, canManage }));
    const readonly = render(false);
    expect(readonly).toContain("App A"); expect(readonly).toContain("App B");
    expect(readonly).toContain("P-A"); expect(readonly).toContain("P-B");
    for (const control of ["Archivar", "Reactivar", "Vincular plan de PayPal", "<input", "<form"]) expect(readonly).not.toContain(control);
    expect(render(true)).toContain("Vincular plan de PayPal");
    expect(render(true)).toContain("Archivar");
    const legacy = renderToStaticMarkup(createElement(ProviderMappings, { kind: "plan", resourceId: price.id, initialMappings: [{ ...mapping("legacy"), connectionScope: "unassigned", providerConnectionId: null }], options, canManage: false }));
    expect(legacy).toContain("Asociación anterior sin conexión identificada");
    expect(legacy).not.toContain("Global heredada");
  });
  test("formulario de append no edita IDs anteriores ni solicita secretos", () => {
    const html = renderToStaticMarkup(createElement(ProviderMappingForm, { options, onSave: async () => {}, onCancel: () => {} }));
    expect(html).toContain("Conexión PayPal");
    expect(html).toContain("ID del plan en PayPal");
    expect(html).not.toContain("P-A"); expect(html).not.toContain("P-B");
    expect(html).not.toContain('type="password"');
  });
  test("cambiar proveedor del addon descarta app o Global previos y exige nueva elección explícita", () => {
    for (const previous of [
      { provider: "paypal" as const, connectionScope: "connection" as const, providerConnectionId: "A" },
      { provider: "paypal" as const, connectionScope: "global" as const, providerConnectionId: null },
    ]) {
      const original = { ...previous };
      const next = changeAddonProvider(previous, "stripe");
      expect(next).toEqual({ provider: "stripe", connectionScope: "unassigned", providerConnectionId: null });
      expect(previous).toEqual(original);
      expect(prepareProviderMapping({ ...next, providerPriceId: "P-STRIPE", providerProductId: "" }).error).toContain("Selecciona");
      const explicitlyGlobal = { ...next, connectionScope: "global" as const };
      expect(prepareProviderMapping({ ...explicitlyGlobal, providerPriceId: "P-STRIPE", providerProductId: "" }).payload?.providerConnectionId).toBeNull();
      const backToPaypal = changeAddonProvider(explicitlyGlobal, "paypal");
      expect(backToPaypal.connectionScope).toBe("unassigned");
      expect(backToPaypal.providerConnectionId).toBeNull();
      expect(prepareProviderMapping({ ...backToPaypal, providerPriceId: "P-PAYPAL", providerProductId: "" }).error).toContain("Selecciona");
    }
  });
  test("PlanForm mantiene bindings del catálogo; addon existente conserva ID legacy sólo como texto", () => {
    const html = renderToStaticMarkup(createElement(PlanForm, { initialPlan: { id: "plan", productId: "product-1", code: "plan", name: "Plan", description: null, status: "active", versions: [{ id: "v1", version: 1, status: "published", effectiveFrom: null, effectiveUntil: null, entitlements: [], prices: [price] }] }, products: [], onSubmit: async () => {}, submitLabel: "Guardar" }));
    expect(html).toContain("Conexión A"); expect(html).toContain("Conexión B");
    expect(html).toContain('value="P-A"'); expect(html).toContain('value="P-B"');
    const addon = { id: "addon", productId: "product-1", productCode: "medsync", code: "addon", name: "Addon", description: null, unitPrice: "10.00", currency: "MXN" as const, billingInterval: "monthly" as const, type: "recurring" as const, pricingModel: "flat" as const, minQuantity: 1, maxQuantity: 1, provider: "paypal" as const, providerPlanId: "P-LEGACY", entitlementEffects: { numeric: {}, features: {} }, status: "active" as const };
    const existing = renderToStaticMarkup(createElement(AddonForm, { initialAddon: addon, products: [], onSubmit: async () => {}, submitLabel: "Guardar" }));
    expect(existing).toContain("P-LEGACY"); expect(existing).toContain("sólo lectura");
    expect(existing).not.toContain('name="providerPlanId"');
    expect(existing).not.toContain('name="mappingProviderPriceId"');
    const first = renderToStaticMarkup(createElement(AddonForm, { defaultProductId: "product-1", products: [], onSubmit: async () => {}, submitLabel: "Crear" }));
    expect(first).toContain('name="mappingProviderPriceId"');
    expect(first).not.toContain('name="providerPlanId"');
  });
});
