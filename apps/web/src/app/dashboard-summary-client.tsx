"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  FileWarning,
  KeyRound,
  RefreshCw,
  ShieldAlert,
  TicketCheck,
  Webhook,
} from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { hasPermission, useSession } from "@/components/auth-gate";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  redirectToLogin,
} from "@/lib/api";

type BillingDashboardSummary = {
  subscriptions: Record<string, number>;
  pendingCheckouts: number;
  failedCheckouts: number;
  inactiveLicenses: number;
  pendingInvoices: number;
  failedInvoices: number;
  failedWebhooks: number;
  webhookRetries24h: number;
};

const quickLinks = [
  {
    href: "/operations?section=checkouts&status=failed",
    icon: <AlertTriangle className="size-5" />,
    label: "Checkouts fallidos",
    description: "Sesiones que requieren intervención.",
    tone: "danger",
  },
  {
    href: "/operations?section=licenses&status=inactive",
    icon: <KeyRound className="size-5" />,
    label: "Licencias no activas",
    description: "Acceso suspendido, revocado o en gracia.",
    tone: "warning",
  },
  {
    href: "/invoices?status=pending",
    icon: <FileWarning className="size-5" />,
    label: "Invoices pendientes",
    description: "Facturas pendientes de operación fiscal.",
    tone: "warning",
  },
  {
    href: "/invoices?status=failed",
    icon: <FileWarning className="size-5" />,
    label: "Invoices fallidas",
    description: "Errores fiscales saneados por Billing Core.",
    tone: "danger",
  },
  {
    href: "/webhooks?processing_status=failed",
    icon: <Webhook className="size-5" />,
    label: "Webhooks fallidos",
    description: "Eventos verificados listos para revisión.",
    tone: "danger",
  },
];

let summaryRequest: Promise<BillingDashboardSummary> | null = null;

function getDashboardSummary() {
  summaryRequest ??= apiFetch<BillingDashboardSummary>(
    "/billing/console/dashboard/summary",
  );
  return summaryRequest;
}

export function DashboardSummaryClient() {
  const session = useSession();
  const [summary, setSummary] = useState<BillingDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const canReadDashboard = hasPermission(session, "billing.dashboard.read");

  useEffect(() => {
    if (!canReadDashboard) {
      return;
    }

    let cancelled = false;
    getDashboardSummary()
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((error) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setMessage(apiErrorMessage(error, "No se pudo cargar el resumen operativo."));
      })
      .finally(() => {
        summaryRequest = null;
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canReadDashboard]);

  if (!canReadDashboard) {
    return (
      <Alert variant="destructive">
        <ShieldAlert className="size-4" />
        <AlertTitle>Sin permiso</AlertTitle>
        <AlertDescription>
          No tienes permiso para consultar el resumen operativo.
        </AlertDescription>
      </Alert>
    );
  }

  if (loading) {
    return <DashboardSkeleton />;
  }

  if (message) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="size-4" />
        <AlertTitle>No se pudo cargar el resumen</AlertTitle>
        <AlertDescription>{message}</AlertDescription>
      </Alert>
    );
  }

  const data = summary ?? emptySummary();
  const activeSubscriptions = data.subscriptions.active ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={<TicketCheck className="size-5" />}
          label="Suscripciones activas"
          value={formatCount(activeSubscriptions)}
        />
        <StatCard
          icon={<ClipboardCheck className="size-5" />}
          label="Checkouts pendientes"
          value={formatCount(data.pendingCheckouts)}
        />
        <CriticalMetricCard
          icon={<AlertTriangle className="size-5" />}
          label="Checkouts fallidos"
          value={formatCount(data.failedCheckouts)}
        />
        <CriticalMetricCard
          icon={<KeyRound className="size-5" />}
          label="Licencias no activas"
          value={formatCount(data.inactiveLicenses)}
        />
        <StatCard
          icon={<FileWarning className="size-5" />}
          label="Invoices pendientes"
          tone="violet"
          value={formatCount(data.pendingInvoices)}
        />
        <CriticalMetricCard
          icon={<FileWarning className="size-5" />}
          label="Invoices fallidas"
          value={formatCount(data.failedInvoices)}
        />
        <CriticalMetricCard
          icon={<Webhook className="size-5" />}
          label="Webhooks fallidos"
          value={formatCount(data.failedWebhooks)}
        />
        <StatCard
          icon={<RefreshCw className="size-5" />}
          label="Reintentos webhook 24h"
          value={formatCount(data.webhookRetries24h)}
        />
      </div>

      <section>
        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-bold">Accesos rápidos</h2>
            <p className="text-sm text-supporting">
              Vistas filtradas para resolver pendientes comunes.
            </p>
          </div>
          <span className="text-xs font-bold uppercase text-muted-foreground">
            {quickLinks.length} accesos
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {quickLinks.map((link) => (
            <Link
              className="group flex min-h-12 items-start gap-3 rounded-lg border border-border bg-card p-4 shadow-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              href={link.href}
              key={link.href}
            >
              <span className={quickLinkTone(link.tone)}>{link.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-foreground">
                  {link.label}
                </span>
                <span className="mt-1 block text-sm leading-6 text-supporting">
                  {link.description}
                </span>
              </span>
              <ArrowRight className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

function CriticalMetricCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="grid size-12 place-items-center rounded-full bg-red-50 text-red-700">
        {icon}
      </div>
      <p className="mt-4 truncate text-sm font-bold">{label}</p>
      <p className="mt-2 text-2xl font-bold">{value}</p>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, index) => (
        <div
          className="rounded-lg border border-border bg-card p-5 shadow-sm"
          key={index}
        >
          <Skeleton className="size-12 rounded-full" />
          <Skeleton className="mt-4 h-4 w-2/3" />
          <Skeleton className="mt-3 h-7 w-20" />
        </div>
      ))}
    </div>
  );
}

function emptySummary(): BillingDashboardSummary {
  return {
    subscriptions: {},
    pendingCheckouts: 0,
    failedCheckouts: 0,
    inactiveLicenses: 0,
    pendingInvoices: 0,
    failedInvoices: 0,
    failedWebhooks: 0,
    webhookRetries24h: 0,
  };
}

function formatCount(value: number | undefined): string {
  return new Intl.NumberFormat("es-MX").format(value ?? 0);
}

function quickLinkTone(tone: string): string {
  if (tone === "danger")
    return "grid size-12 shrink-0 place-items-center rounded-full bg-red-50 text-red-700";
  return "grid size-12 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700";
}
