export const integrationTypes = [
  {
    key: "oauth",
    title: "Clientes OAuth",
    description: "Autoriza aplicaciones de Identity y limita su acceso a productos y organizaciones de Billing.",
    availability: "Configurable",
    href: "/integrations/oauth",
  },
  {
    key: "legal",
    title: "Hemia Legal",
    description: "Consulta la conexión de servicio y la validación de aceptaciones durante el checkout.",
    availability: "Consulta disponible",
    href: "/integrations/legal",
  },
  {
    key: "payments",
    title: "Proveedores de pago",
    description: "Billing crea checkouts y administra suscripciones con PayPal.",
    availability: "Disponible en checkout",
    href: "/integrations/payments",
  },
  {
    key: "events",
    title: "Eventos y webhooks",
    description: "Consulta la recepción y el procesamiento de eventos de pago.",
    availability: "Consulta disponible",
    href: "/integrations/events",
  },
] as const;

export type IntegrationType = (typeof integrationTypes)[number]["key"];
