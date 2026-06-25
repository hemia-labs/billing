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
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/catalog", label: "Catálogo", icon: Boxes },
  { href: "/operations", label: "Operación", icon: Activity },
  { href: "/addons", label: "Add-ons", icon: Puzzle },
  { href: "/invoices", label: "Facturas", icon: ReceiptText },
  { href: "/webhooks", label: "Webhooks", icon: Webhook },
  { href: "/audit", label: "Auditoría", icon: ClipboardList },
  { href: "/integrations", label: "Integraciones", icon: Cable },
  { href: "/settings", label: "Configuración", icon: Settings },
];

export function labelFor(pathname: string) {
  const match = nav
    .filter((n) => (n.href === "/" ? pathname === "/" : pathname.startsWith(n.href)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return match?.label ?? "Billing";
}
