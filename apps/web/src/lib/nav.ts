import {
  Activity,
  Boxes,
  Cable,
  ClipboardList,
  LayoutDashboard,
  Puzzle,
  ReceiptText,
  Settings,
  Webhook,
} from "lucide-react";

export const nav = [
  { permission: "billing.dashboard.read", href: "/", label: "Resumen", icon: LayoutDashboard },
  { permission: "billing.catalog.read", href: "/products", label: "Productos", icon: Boxes },
  { permission: "billing.subscriptions.read", href: "/operations", label: "Operación", icon: Activity },
  { permission: "billing.catalog.read", href: "/addons", label: "Add-ons", icon: Puzzle },
  { permission: "billing.invoices.read", href: "/invoices", label: "Facturas", icon: ReceiptText },
  { permission: "billing.webhooks.read", href: "/webhooks", label: "Webhooks", icon: Webhook },
  { permission: "billing.audit.read", href: "/audit", label: "Auditoría", icon: ClipboardList },
  { permission: "billing.webhooks.read", href: "/integrations", label: "Integraciones", icon: Cable },
  { permission: "billing.catalog.manage", href: "/settings", label: "Configuración", icon: Settings },
];

export function labelFor(pathname: string) {
  const match = nav
    .filter((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Billing";
}
