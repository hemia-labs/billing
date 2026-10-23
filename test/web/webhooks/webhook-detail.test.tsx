import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebhookEventSummary } from "../../../apps/web/src/app/webhooks/[id]/webhook-event-summary";
import { WebhookManualRetryHistory } from "../../../apps/web/src/app/webhooks/[id]/webhook-manual-retries";
import type { WebhookManualRetryPage } from "../../../apps/web/src/app/webhooks/webhook-display";

const page: WebhookManualRetryPage = {
  items: [{ id: "retry-1", actorUserId: "user-1", attempt: 2, reason: "<script>alert('retry')</script>\nRevisado", createdAt: "2026-10-22T12:00:00Z" }],
  total: 21,
  page: 2,
  limit: 10,
};
const renderHistory = (props: Partial<Parameters<typeof WebhookManualRetryHistory>[0]> = {}) => renderToStaticMarkup(createElement(WebhookManualRetryHistory, { data: page, loading: false, error: "", onReload: () => {}, onPageChange: () => {}, ...props }));

describe("detalle de webhook", () => {
  test("el resumen muestra solo campos conocidos y conserva importes exactos", () => {
    const html = renderToStaticMarkup(createElement(WebhookEventSummary, { summary: { amount: "1234567890.123456789", currency: "MXN", eventCreatedAt: "2026-10-22T12:00:00Z", resourceStatus: "<script>alert(1)</script>", email: "private@example.com", payloadJson: "sensitive" } }));
    expect(html).toContain("1234567890.123456789");
    expect(html).toContain("MXN");
    expect(html).toContain("2026");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("private@example.com");
    expect(html).not.toContain("sensitive");
  });
  test("el resumen explica cuando no hay campos disponibles", () => {
    const html = renderToStaticMarkup(createElement(WebhookEventSummary, { summary: {} }));
    expect(html).toContain("no contiene datos adicionales");
  });
  test("el historial muestra autor, intento, motivo escapado y rango paginado", () => {
    const html = renderHistory();
    expect(html).toContain("user-1");
    expect(html).toContain("11–11 de 21 reintentos");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("aria-label=\"Paginación de reintentos manuales\"");
    expect(html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("Siguiente"))).not.toContain('disabled=""');
  });
  test("la primera página vacía no ofrece avanzar y la última desactiva siguiente", () => {
    const empty = renderHistory({ data: { items: [], total: 0, page: 1, limit: 10 } });
    expect(empty).toContain("No hay reintentos manuales registrados");
    expect(empty).not.toContain("Paginación de reintentos manuales");
    const last = renderHistory({ data: { ...page, page: 3 } });
    expect(last.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find((button) => button.includes("Siguiente"))).toContain('disabled=""');
  });
  test("carga y error son independientes y no muestran datos anteriores", () => {
    const loading = renderHistory({ data: null, loading: true });
    expect(loading).toContain("Cargando reintentos manuales");
    expect(loading).not.toContain("user-1");
    const error = renderHistory({ error: "No tienes permiso para esta acción." });
    expect(error).toContain("role=\"alert\"");
    expect(error).toContain("No tienes permiso");
    expect(error).toContain("Volver a intentar");
    expect(error).not.toContain("user-1");
  });
  test("registros históricos incompletos tienen etiquetas legibles", () => {
    const html = renderHistory({ data: { ...page, items: [{ ...page.items[0], actorUserId: null, reason: null, attempt: null }] } });
    expect(html).toContain("Usuario no disponible");
    expect(html).toContain("Sin motivo registrado");
    expect(html).toContain("Sin registro");
  });
});
