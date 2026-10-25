import { describe, expect, test } from "bun:test";
import { formatDate, processingLabels, statusTone } from "../../../apps/web/src/app/webhooks/webhook-display";

describe("presentación de webhooks", () => {
  test("todos los estados del proveedor tienen etiqueta en español y tono", () => {
    expect(processingLabels).toEqual({ pending: "Pendiente", processing: "En proceso", processed: "Procesado", failed: "Fallido", ignored: "Ignorado" });
    expect(Object.keys(statusTone).sort()).toEqual(Object.keys(processingLabels).sort());
  });
  test("las fechas ausentes o inválidas no rompen la vista", () => {
    expect(formatDate(null)).toBe("Sin registro");
    expect(formatDate("invalid")).toBe("Fecha no disponible");
    expect(formatDate("2026-10-22T12:00:00Z")).toContain("2026");
  });
});
