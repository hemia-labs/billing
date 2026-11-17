export const integrationTypes = [
  {
    key: "oauth",
    title: "Clientes OAuth",
    description: "Conecta aplicaciones de Identity y administra su acceso.",
    availability: "Configurable",
    href: "/integrations/oauth",
  },
  {
    key: "legal",
    title: "Hemia Legal",
    description: "Consulta los acuerdos legales asociados al checkout.",
    availability: "Consulta disponible",
    href: "/integrations/legal",
  },
  {
    key: "payments",
    title: "Proveedores de pago",
    description: "Conecta PayPal y administra las apps que reciben tus pagos.",
    availability: "Configurable",
    href: "/integrations/payments",
  },
  {
    key: "events",
    title: "Eventos y webhooks",
    description: "Consulta los eventos de pago y sus entregas.",
    availability: "Consulta disponible",
    href: "/integrations/events",
  },
] as const;

export type IntegrationType = (typeof integrationTypes)[number]["key"];

export function visibleIntegrationTypes(permissions: readonly string[], creating = false) {
  return integrationTypes.filter((item) => item.key === "payments"
    ? permissions.includes("billing.catalog.read") && (!creating || permissions.includes("billing.catalog.manage"))
    : permissions.includes(creating ? "billing.integrations.manage" : "billing.integrations.read"));
}
