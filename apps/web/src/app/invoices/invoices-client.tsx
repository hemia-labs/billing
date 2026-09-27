"use client";

import { type FormEvent, useEffect, useState } from "react";
import { FileText, RefreshCw, Search } from "lucide-react";
import { StatusBadge } from "@/components/zuno/status-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import { hasPermission, useSession } from "@/components/auth-gate";
import {
  ApiError,
  apiErrorMessage,
  apiFetch,
  redirectToLogin,
  toQueryString,
} from "@/lib/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InvoiceStatus = "pending" | "issued" | "cancelled" | "failed";

type Invoice = {
  id: string;
  organizationId: string;
  paymentId: string;
  cfdiUuid: string | null;
  rfc: string;
  legalName: string;
  taxRegime: string;
  cfdiUse: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  currency: string;
  status: InvoiceStatus;
  xmlUrl: string | null;
  pdfUrl: string | null;
  issuedAt: string | null;
  createdAt: string;
};

type Filters = {
  organization_id: string;
  payment_id: string;
  status: "" | InvoiceStatus;
  created_from: string;
  created_to: string;
  issued_from: string;
  issued_to: string;
};

const emptyFilters: Filters = {
  organization_id: "",
  payment_id: "",
  status: "",
  created_from: "",
  created_to: "",
  issued_from: "",
  issued_to: "",
};

const statusLabel: Record<InvoiceStatus, string> = {
  pending: "Pendiente",
  issued: "Emitida",
  cancelled: "Cancelada",
  failed: "Fallida",
};

const statusTone: Record<InvoiceStatus, "warning" | "success" | "neutral" | "error"> = {
  pending: "warning",
  issued: "success",
  cancelled: "neutral",
  failed: "error",
};

export function InvoicesClient() {
  const session = useSession();
  const canRead = hasPermission(session, "billing.invoices.read");
  const canIssue = hasPermission(session, "billing.invoices.issue");
  const canCancel = hasPermission(session, "billing.invoices.cancel");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const loadInvoices = async (nextFilters = filters) => {
    setLoading(true);
    setMessage("");

    try {
      setInvoices(
        await apiFetch<Invoice[]>(
          `/billing/console/invoices${toQueryString(nextFilters)}`,
        ),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(apiErrorMessage(error, "No se pudieron cargar las facturas."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => loadInvoices(emptyFilters));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void loadInvoices(filters);
  };

  const runAction = async (invoice: Invoice, action: "issue" | "cancel") => {
    setMessage("");

    try {
      await apiFetch(`/billing/console/invoices/${invoice.id}/${action}`, {
        method: "POST",
      });
      await loadInvoices();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setMessage(
        apiErrorMessage(
          error,
          action === "issue"
            ? "Emisión fiscal no disponible."
            : "No se pudo cancelar la factura.",
        ),
      );
    }
  };

  if (!canRead) {
    return (
      <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
        No tienes permiso para consultar facturas.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 rounded-2xl border border-surface-line bg-card p-5 shadow-sm md:grid-cols-3 xl:grid-cols-8"
        onSubmit={submitFilters}
      >
        <Input aria-label="Organización" placeholder="Organización" value={filters.organization_id} onChange={(event) => setFilters({ ...filters, organization_id: event.target.value })} />
        <Input aria-label="Payment" placeholder="Payment" value={filters.payment_id} onChange={(event) => setFilters({ ...filters, payment_id: event.target.value })} />
        <Select value={filters.status || "all"} onValueChange={(value) => setFilters({ ...filters, status: (value === "all" ? "" : value) as Filters["status"] })}>
          <SelectTrigger aria-label="Estado"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            {Object.entries(statusLabel).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="Creada desde" type="date" value={filters.created_from} onChange={(event) => setFilters({ ...filters, created_from: event.target.value })} />
        <Input aria-label="Creada hasta" type="date" value={filters.created_to} onChange={(event) => setFilters({ ...filters, created_to: event.target.value })} />
        <Input aria-label="Emitida desde" type="date" value={filters.issued_from} onChange={(event) => setFilters({ ...filters, issued_from: event.target.value })} />
        <Input aria-label="Emitida hasta" type="date" value={filters.issued_to} onChange={(event) => setFilters({ ...filters, issued_to: event.target.value })} />
        <Button className="gap-2" type="submit">
          <Search className="size-4" />
          Filtrar
        </Button>
      </form>

      {message ? (
        <div className="rounded-2xl border border-surface-line bg-card px-5 py-4 text-sm font-medium text-destructive shadow-sm">
          {message}
        </div>
      ) : null}

      <section className="rounded-2xl border border-surface-line bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-bold">Facturas fiscales</h2>
          <Button aria-label="Recargar facturas" onClick={() => void loadInvoices()} size="icon" variant="outline">
            <RefreshCw className="size-4" />
          </Button>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fiscal</TableHead>
              <TableHead>Montos</TableHead>
              <TableHead>CFDI</TableHead>
              <TableHead>Fechas</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5}>Cargando facturas...</TableCell>
              </TableRow>
            ) : invoices.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>Aún no hay facturas para mostrar.</TableCell>
              </TableRow>
            ) : (
              invoices.map((invoice) => (
                <TableRow key={invoice.id}>
                  <TableCell>
                    <div className="font-semibold">{invoice.legalName}</div>
                    <div className="text-xs text-muted-foreground">{invoice.rfc} · Régimen {invoice.taxRegime} · Uso {invoice.cfdiUse}</div>
                    <div className="text-xs text-muted-foreground">Org {invoice.organizationId}</div>
                  </TableCell>
                  <TableCell>
                    <div className="font-semibold">{invoice.total} {invoice.currency}</div>
                    <div className="text-xs text-muted-foreground">Subtotal {invoice.subtotal} · IVA {invoice.taxAmount}</div>
                    <div className="text-xs text-muted-foreground">Payment {invoice.paymentId}</div>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={statusTone[invoice.status]}>{statusLabel[invoice.status]}</StatusBadge>
                    <div className="mt-2 text-xs text-muted-foreground">{invoice.cfdiUuid ?? "Sin UUID CFDI"}</div>
                    <div className="mt-1 flex gap-2 text-xs">
                      {invoice.xmlUrl ? <a className="text-primary hover:underline" href={invoice.xmlUrl}>XML</a> : null}
                      {invoice.pdfUrl ? <a className="text-primary hover:underline" href={invoice.pdfUrl}>PDF</a> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <div>Creada {formatDate(invoice.createdAt)}</div>
                    <div>Emitida {invoice.issuedAt ? formatDate(invoice.issuedAt) : "pendiente"}</div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {canIssue && invoice.status === "pending" ? (
                        <Button onClick={() => void runAction(invoice, "issue")} size="sm">
                          <FileText className="size-4" />
                          Emitir
                        </Button>
                      ) : null}
                      {canCancel && invoice.status === "issued" ? (
                        <Button onClick={() => void runAction(invoice, "cancel")} size="sm" variant="outline">
                          Cancelar
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
