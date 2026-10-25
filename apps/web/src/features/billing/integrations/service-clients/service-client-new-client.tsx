"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasPermission, useSession } from "@/components/auth-gate";
import { Button } from "@/components/zuno/button";
import { Card } from "@/components/zuno/card";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { ServiceClientForm } from "./service-client-form";
import { listServiceClients, type ServiceClient } from "./service-clients-api";

export function ServiceClientNewClient({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const session = useSession();
  const canManage = hasPermission(session, "billing.integrations.manage");
  const returnHref = clientId ? `/integrations/clients/${encodeURIComponent(clientId)}` : "/integrations/oauth";
  const [client, setClient] = useState<ServiceClient | null>(null);
  const [existingIds, setExistingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    listServiceClients(controller.signal)
      .then((clients) => {
        if (controller.signal.aborted) return;
        setExistingIds(clients.map((client) => client.clientId));
        if (clientId) {
          const existing = clients.find((client) => client.clientId === clientId);
          if (existing) setClient(existing);
          else setError("El cliente autorizado no existe o ya no está disponible.");
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setError(apiErrorMessage(error, "No se pudieron consultar los clientes registrados."));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, revision, clientId]);

  return (
    <Card className="rounded-lg p-5 shadow-sm sm:p-6">
      {!canManage ? (
        <p role="alert" className="text-sm text-destructive">
          No tienes permiso para administrar clientes autorizados.
        </p>
      ) : loading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Cargando configuración de integraciones…
        </p>
      ) : error ? (
        <div>
          <p role="alert" className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => {
              setLoading(true);
              setError("");
              setRevision((value) => value + 1);
            }}
          >
            Reintentar
          </Button>
        </div>
      ) : (
        <ServiceClientForm
          client={client}
          existingIds={existingIds}
          onCancel={() => router.push(returnHref)}
          onSaved={() => router.push(returnHref)}
        />
      )}
    </Card>
  );
}
