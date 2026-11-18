import { describe, expect, test } from "bun:test";
import catalog from "../../../apps/api/src/modules/auth/billing-authorization-v2.json";
import { homeRedirect, nav } from "../../../apps/web/src/lib/nav";

describe("navegación del lector global de webhooks", () => {
  test("permite llegar a /webhooks sin conceder dashboard, catálogo ni reintentos", () => {
    const role = catalog.roles.find((item) => item.code === "billing.webhook_viewer");
    expect(role?.permissions).toEqual(["billing.webhooks.read"]);
    const visible = nav.filter((item) => role?.permissions.includes(item.permission));
    expect(visible.map((item) => item.href)).toEqual(["/webhooks"]);
    expect(homeRedirect(role?.permissions ?? [])).toBe("/webhooks");
    expect(role?.permissions).not.toContain("billing.webhooks.retry");
  });

  test("conserva el dashboard habilitado y no redirige a webhooks sin permiso", () => {
    expect(homeRedirect(["billing.dashboard.read", "billing.webhooks.read"])).toBeNull();
    expect(homeRedirect(["billing.dashboard.read"])).toBeNull();
    expect(homeRedirect(["billing.subscriptions.read"])).toBeNull();
    expect(homeRedirect([])).toBeNull();
  });
});
