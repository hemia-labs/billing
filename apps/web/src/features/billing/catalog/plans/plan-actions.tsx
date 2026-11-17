"use client";

import { useRef, useState } from "react";
import { Archive, MoreVertical, RotateCcw, Trash2 } from "lucide-react";
import { Alert } from "@/components/zuno/alert";
import { Button } from "@/components/zuno/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/zuno/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/zuno/dropdown-menu";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import { type CatalogPlan, deleteCatalogPlan, updateCatalogPlan } from "../catalog-api";

type PlanAction = "archive" | "activate" | "delete";

const actionLabels: Record<PlanAction, string> = {
  archive: "Desactivar",
  activate: "Reactivar",
  delete: "Eliminar",
};

export function PlanActions({ plan, disabled, onUpdated, onDeleted }: {
  plan: Pick<CatalogPlan, "id" | "name" | "status">;
  disabled: boolean;
  onUpdated: (plan: CatalogPlan) => void;
  onDeleted: () => void;
}) {
  const [action, setAction] = useState<PlanAction | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const statusAction = plan.status === "active" ? "archive" : "activate";
  const chooseAction = (next: PlanAction) => {
    setError("");
    setAction(next);
  };
  const confirm = async () => {
    if (!action || disabled || submitting.current) return;
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      if (action === "delete") {
        await deleteCatalogPlan(plan.id);
        onDeleted();
      } else {
        const next = await updateCatalogPlan(plan.id, { status: action === "archive" ? "archived" : "active" });
        onUpdated(next);
      }
      setAction(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) {
        redirectToLogin();
        return;
      }
      setError(cause instanceof ApiError && cause.status === 409 && action === "delete"
        ? "No se puede eliminar este plan porque tiene suscripciones u operaciones asociadas. Puedes desactivarlo para impedir nuevas contrataciones."
        : cause instanceof ApiError && cause.status === 429
          ? "Demasiadas solicitudes. Espera un momento y vuelve a intentarlo."
          : apiErrorMessage(cause, "No se pudo completar la acción. Vuelve a intentarlo."));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger ref={trigger} aria-label="Acciones del plan" disabled={disabled || pending} render={<Button size="icon" type="button" variant="outline" />}>
          <MoreVertical aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => chooseAction(statusAction)}>
            {statusAction === "archive" ? <Archive aria-hidden="true" className="size-4" /> : <RotateCcw aria-hidden="true" className="size-4" />}
            {actionLabels[statusAction]} plan
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive data-[highlighted]:text-destructive" onClick={() => chooseAction("delete")}>
            <Trash2 aria-hidden="true" className="size-4" />Eliminar plan
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog dismissible={!pending} onOpenChange={(open) => { if (!open && !pending) setAction(null); }} open={action !== null}>
        <DialogContent finalFocus={trigger} showClose={!pending}>
          <DialogHeader>
            <DialogTitle>{action ? actionLabels[action] : "Acciones del"} plan</DialogTitle>
            <DialogDescription className="break-words">
              {action === "delete"
                ? `Se retirará «${plan.name}» del catálogo. Sólo puedes eliminar planes sin suscripciones ni operaciones asociadas.`
                : action === "archive"
                  ? `Se archivará «${plan.name}» y dejará de estar disponible para nuevas contrataciones. Las suscripciones existentes se conservan.`
                  : `«${plan.name}» volverá a estar activo en el catálogo.`}
            </DialogDescription>
          </DialogHeader>
          {error ? <Alert className="mt-4" role="alert" variant="destructive">{error}</Alert> : null}
          <DialogFooter>
            <Button disabled={pending} onClick={() => setAction(null)} type="button" variant="outline">Cancelar</Button>
            <Button disabled={pending || disabled} onClick={() => void confirm()} type="button" variant={action === "delete" ? "destructive" : "default"}>
              {pending ? "Procesando…" : action ? actionLabels[action] : "Confirmar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
