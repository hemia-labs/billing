"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { Button } from "@/components/zuno/button";
import { Card } from "@/components/zuno/card";
import { Input } from "@/components/zuno/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { Textarea } from "@/components/ui/textarea";
import type { CatalogProductPayload } from "../catalog-api";

type RequiredField = "name" | "code";

export function ProductForm({
  onSubmit,
  submitLabel,
  initialProduct,
  onChange,
  renderAssistAction,
}: {
  onSubmit: (payload: CatalogProductPayload) => Promise<void>;
  submitLabel: string;
  initialProduct?: CatalogProductPayload;
  onChange?: (payload: CatalogProductPayload) => void;
  renderAssistAction?: (state: { hasContent: boolean; disabled: boolean }) => ReactNode;
}) {
  const [name, setName] = useState(initialProduct?.name ?? "");
  const [code, setCode] = useState(initialProduct?.code ?? "");
  const [description, setDescription] = useState(initialProduct?.description ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(initialProduct?.status ?? "active");
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<RequiredField, string>>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onChange?.({ name, code, description, status });
  }, [name, code, description, status, onChange]);

  const clearError = (field: RequiredField) => {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedCode = code.trim();
    const errors: Partial<Record<RequiredField, string>> = {};
    if (!trimmedName) errors.name = "Escribe el nombre del producto.";
    if (!trimmedCode) errors.code = "Escribe el código del producto.";
    if (!trimmedName || !trimmedCode) {
      setFieldErrors(errors);
      event.currentTarget.querySelector<HTMLInputElement>(!trimmedName ? "#product-name" : "#product-code")?.focus();
      return;
    }

    setSaving(true);
    setMessage("");
    setFieldErrors({});

    try {
      await onSubmit({
        name: trimmedName,
        code: trimmedCode,
        description: description.trim() || null,
        status,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <form className="p-5 md:p-6" noValidate onSubmit={submit}>
        {renderAssistAction && <div className="mb-3">{renderAssistAction({ hasContent: Boolean(name.trim() || code.trim() || description.trim()), disabled: saving })}</div>}
        <div className="space-y-5">
          <label className="grid gap-2 text-sm font-medium" htmlFor="product-name">
            Nombre
            <Input
              aria-describedby={fieldErrors.name ? "product-name-error" : undefined}
              aria-invalid={Boolean(fieldErrors.name)}
              id="product-name"
              maxLength={120}
              name="name"
              onChange={() => clearError("name")}
              onInput={(event) => setName(event.currentTarget.value)}
              placeholder="Ej. Hemia Agenda"
              required
              value={name}
            />
            {fieldErrors.name && <span className="text-xs text-destructive" id="product-name-error">{fieldErrors.name}</span>}
          </label>

          <div className="grid items-start gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
            <label className="grid gap-2 text-sm font-medium" htmlFor="product-code">
              Código
              <Input
                aria-describedby={fieldErrors.code ? "product-code-error" : "product-code-help"}
                aria-invalid={Boolean(fieldErrors.code)}
                id="product-code"
                maxLength={80}
                name="code"
                onChange={() => clearError("code")}
                onInput={(event) => setCode(event.currentTarget.value)}
                placeholder="hemia_agenda"
                required
                value={code}
              />
              {fieldErrors.code ? (
                <span className="text-xs text-destructive" id="product-code-error">{fieldErrors.code}</span>
              ) : (
                <span className="text-xs font-normal text-muted-foreground" id="product-code-help">Identificador interno del producto.</span>
              )}
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="product-status">
              Estado
              <Select onValueChange={(value) => setStatus(value === "inactive" ? "inactive" : "active")} value={status}>
                <SelectTrigger className="w-full rounded-lg bg-background font-normal" id="product-status">
                  <SelectValue>{(value: string | null) => value === "inactive" ? "Inactivo" : "Activo"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="inactive">Inactivo</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>

          <label className="grid gap-2 text-sm font-medium" htmlFor="product-description">
            <span>Descripción <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
            <Textarea
              className="min-h-24 bg-background font-normal"
              id="product-description"
              name="description"
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe qué incluye el producto"
              value={description}
            />
          </label>
        </div>

        {message && <p className="mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{message}</p>}

        <div className="mt-6 flex flex-wrap justify-end gap-2 border-t border-border pt-5">
          <Button disabled={saving} render={<Link href="/products" />} type="button" variant="outline">Cancelar</Button>
          <Button disabled={saving} type="submit"><Save className="size-4" />{saving ? "Guardando..." : submitLabel}</Button>
        </div>
      </form>
    </Card>
  );
}
