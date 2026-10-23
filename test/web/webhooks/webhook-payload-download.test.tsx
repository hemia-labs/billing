import { afterEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ApiError } from "../../../apps/web/src/lib/api";
import { payloadDownloadUrl, payloadDownloadError, requestWebhookPayload, saveWebhookPayload } from "../../../apps/web/src/app/webhooks/[id]/webhook-payload-api";
import { WebhookPayloadDownloadForm } from "../../../apps/web/src/app/webhooks/[id]/webhook-payload-download";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("descarga del payload del webhook", () => {
  test("la contraseña sólo puede enviarse por HTTPS salvo desarrollo local", () => {
    expect(() => payloadDownloadUrl("http://billing.example.test/api/v1", "event-1")).toThrow("HTTPS");
    expect(() => payloadDownloadUrl("https://user:secret@billing.example.test/api/v1", "event-1")).toThrow("HTTPS");
    expect(payloadDownloadUrl("https://billing.example.test/api/v1", "event/1").pathname).toBe("/api/v1/billing/console/webhooks/event%2F1/payload/download");
  });
  test("no envía contraseña desde una página sin contexto seguro", async () => {
    const originalWindow = globalThis.window;
    const fetchMock = mock(() => Promise.resolve(new Response("{}")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      Object.defineProperty(globalThis, "window", { configurable: true, value: { isSecureContext: false } });
      await expect(requestWebhookPayload("event-1", "password", "Diagnóstico")).rejects.toThrow("página segura");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });
  test("sólo usa POST autenticado sin caché y entrega un blob sin parsear el payload", async () => {
    const content = '{"id":"event-1","sensitive":"private"}';
    const fetchMock = mock(async () => new Response(content, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="webhook.json"' } }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const controller = new AbortController();
    const blob = await requestWebhookPayload("event/1", " password ", "Diagnóstico autorizado", controller.signal);
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe(content);
    const [url, options] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toEndWith("/billing/console/webhooks/event%2F1/payload/download");
    expect(url).not.toContain("password");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(options.credentials).toBe("include");
    expect(options.cache).toBe("no-store");
    expect(options.signal).toBe(controller.signal);
    expect(JSON.parse(options.body as string)).toEqual({ password: " password ", reason: "Diagnóstico autorizado" });
  });
  test("rechazos no exponen cuerpos sensibles de respuesta", async () => {
    for (const status of [401, 403, 429, 503]) {
      globalThis.fetch = mock(async () => new Response('{"password":"secret","payload":"private"}', { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
      try {
        await requestWebhookPayload("id", "secret", "Soporte");
        throw new Error("La descarga debió ser rechazada");
      } catch (error) {
        expect(error).toBeInstanceOf(ApiError);
        expect((error as ApiError).status).toBe(status);
        expect((error as Error).message).toBe(payloadDownloadError(status));
        expect((error as Error).message).not.toContain("private");
        expect((error as Error).message).not.toContain("secret");
      }
    }
  });
  test("no descarga respuestas HTML como JSON", async () => {
    globalThis.fetch = mock(async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } })) as unknown as typeof fetch;
    await expect(requestWebhookPayload("id", "secret", "Soporte")).rejects.toThrow("No se recibió un archivo JSON válido.");
  });
  test("el formulario exige contraseña privada y motivo acotado sin valores secretos", () => {
    const html = renderToStaticMarkup(createElement(WebhookPayloadDownloadForm, { busy: false, error: "", onSubmit: () => {}, onCancel: () => {} }));
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="current-password"');
    const inputs = html.match(/<input\b[^>]*>/g) ?? [];
    expect(inputs.find((input) => input.includes('name="password"'))).toContain('required=""');
    const reason = html.match(/<textarea\b[^>]*>/)?.[0];
    expect(reason).toContain('name="reason"');
    expect(reason).toContain('maxLength="250"');
    expect(reason).toContain('required=""');
    expect(html).not.toContain('value="secret"');
  });
  test("el envío pendiente deshabilita confirmar y conserva cancelar", () => {
    const html = renderToStaticMarkup(createElement(WebhookPayloadDownloadForm, { busy: true, error: "", onSubmit: () => {}, onCancel: () => {} }));
    const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? [];
    expect(buttons.find((button) => button.includes("Preparando..."))).toContain('disabled=""');
    expect(buttons.find((button) => button.includes("Cancelar"))).not.toContain('disabled=""');
    expect(html).toContain('role="status"');
  });
  test("el guardado crea una descarga y libera el objeto temporal", () => {
    const originalDocument = globalThis.document;
    const originalWindow = globalThis.window;
    const originalCreate = URL.createObjectURL;
    const originalRevoke = URL.revokeObjectURL;
    const click = mock(() => {});
    const remove = mock(() => {});
    const appendChild = mock(() => {});
    const link = { href: "", download: "", click, remove };
    const revoke = mock(() => {});
    try {
      Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: () => link, body: { appendChild } } });
      Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: (callback: () => void) => callback() } });
      URL.createObjectURL = () => "blob:temporary";
      URL.revokeObjectURL = revoke;
      saveWebhookPayload(new Blob(['{"id":"event"}']));
      expect(link.download).toBe("webhook-payload.json");
      expect(link.href).toBe("blob:temporary");
      expect(click).toHaveBeenCalledTimes(1);
      expect(remove).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith("blob:temporary");
    } finally {
      URL.createObjectURL = originalCreate;
      URL.revokeObjectURL = originalRevoke;
      Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });
});
