"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CatalogProduct, CatalogProductPayload } from "./catalog-api";

export function ProductForm({
  initialProduct,
  onSubmit,
  readOnly = false,
  submitLabel,
}: {
  initialProduct?: CatalogProduct;
  onSubmit: (payload: CatalogProductPayload) => Promise<void>;
  readOnly?: boolean;
  submitLabel: string;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;

    const form = new FormData(event.currentTarget);
    const code = stringValue(form, "code");
    const name = stringValue(form, "name");

    if (!code || !name) {
      setMessage("Código y nombre son obligatorios.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await onSubmit({
        code,
        name,
        description: stringValue(form, "description") ?? null,
        status: stringValue(form, "status") as CatalogProduct["status"],
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="rounded-lg border border-border bg-card p-5 shadow-sm" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Código
          <Input defaultValue={initialProduct?.code ?? ""} maxLength={80} name="code" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Nombre
          <Input defaultValue={initialProduct?.name ?? ""} maxLength={120} name="name" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Estado
          <select className={selectClassName} defaultValue={initialProduct?.status ?? "active"} disabled={readOnly} name="status">
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Descripción
          <textarea className="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={initialProduct?.description ?? ""} name="description" readOnly={readOnly} />
        </label>
      </div>

      {message ? <p className="mt-4 text-sm font-medium text-destructive">{message}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button render={<Link href="/products" />} variant="outline"><ArrowLeft className="size-4" />Volver a productos</Button>
        {!readOnly ? (
          <Button disabled={saving} type="submit"><Save className="size-4" />{saving ? "Guardando..." : submitLabel}</Button>
        ) : null}
      </div>
    </form>
  );
}

function stringValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const selectClassName = "h-8 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";
