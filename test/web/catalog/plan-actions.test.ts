import { afterEach, describe, expect, test } from "bun:test";
import { deleteCatalogPlan, updateCatalogPlan } from "../../../apps/web/src/features/billing/catalog/catalog-api";
import { ApiError } from "../../../apps/web/src/lib/api";

const originalFetch = globalThis.fetch;
const id = "10aa22b9-c0e4-4c04-8f91-5f412aaa1d79";
afterEach(() => { globalThis.fetch = originalFetch; });

describe("acciones HTTP del plan", () => {
  test.each(["archived", "active"] as const)("cambia a %s sin reenviar precios ni crear versiones", async (status) => {
    const requests: Array<{ url: string; options?: RequestInit }> = [];
    globalThis.fetch = (async (url, options) => {
      requests.push({ url: String(url), options });
      return Response.json({ id, status, versions: [] });
    }) as typeof fetch;

    expect((await updateCatalogPlan(id, { status })).status).toBe(status);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toEndWith(`/api/v1/billing/console/catalog/plans/${id}`);
    expect(requests[0].options?.method).toBe("PATCH");
    expect(requests[0].options?.credentials).toBe("include");
    expect(JSON.parse(String(requests[0].options?.body))).toEqual({ status });
  });

  test("eliminar usa DELETE con sesión y acepta respuesta vacía 204", async () => {
    let request: RequestInit | undefined;
    let endpoint = "";
    globalThis.fetch = (async (url, options) => {
      endpoint = String(url);
      request = options;
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    expect(await deleteCatalogPlan(id)).toBeUndefined();
    expect(endpoint).toEndWith(`/api/v1/billing/console/catalog/plans/${id}`);
    expect(request?.method).toBe("DELETE");
    expect(request?.credentials).toBe("include");
    expect(request?.body).toBeUndefined();
  });

  test.each([401, 403, 404, 409, 429, 503])("conserva error %s para login, permisos y recuperación del diálogo", async (status) => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return Response.json({ message: "Operation rejected" }, { status });
    }) as typeof fetch;
    try {
      await deleteCatalogPlan(id);
      throw new Error("Expected request to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(status);
      expect((error as ApiError).message).toBe("Operation rejected");
    }
    expect(calls).toBe(1);
  });
});
