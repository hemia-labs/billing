"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  BillingAddonPricingModel,
  BillingAddonType,
  BillingCurrency,
  BillingInterval,
  BillingProvider,
  CatalogAddon,
  CatalogAddonPayload,
  CatalogProduct,
} from "./catalog-api";

const providers: BillingProvider[] = ["paypal", "stripe", "mercado_pago", "manual_transfer"];
const currencies: BillingCurrency[] = ["MXN", "USD"];
const intervals: BillingInterval[] = ["monthly", "yearly"];
const types: BillingAddonType[] = ["recurring"];
const pricingModels: BillingAddonPricingModel[] = ["flat", "per_unit"];

export function AddonForm({
  defaultProductId,
  initialAddon,
  onSubmit,
  products,
  readOnly = false,
  submitLabel,
}: {
  defaultProductId?: string;
  initialAddon?: CatalogAddon;
  onSubmit: (payload: CatalogAddonPayload) => Promise<void>;
  products: CatalogProduct[];
  readOnly?: boolean;
  submitLabel: string;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const productId = initialAddon?.productId ?? defaultProductId ?? "";
  const returnHref = productId ? `/products/${productId}?tab=addons` : "/products";

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;

    const form = new FormData(event.currentTarget);
    const productId = stringValue(form, "productId");
    const code = stringValue(form, "code");
    const name = stringValue(form, "name");
    const unitPrice = stringValue(form, "unitPrice");
    const currency = stringValue(form, "currency") as BillingCurrency | undefined;
    const billingInterval = stringValue(form, "billingInterval") as BillingInterval | undefined;
    const type = stringValue(form, "type") as BillingAddonType | undefined;
    const pricingModel = stringValue(form, "pricingModel") as BillingAddonPricingModel | undefined;
    const provider = stringValue(form, "provider") as BillingProvider | undefined;
    const status = stringValue(form, "status") as CatalogAddon["status"] | undefined;
    const minQuantity = Number(stringValue(form, "minQuantity") ?? 1);
    const rawMaxQuantity = stringValue(form, "maxQuantity");
    const maxQuantity = rawMaxQuantity ? Number(rawMaxQuantity) : null;

    if (!productId || !code || !name || !unitPrice || !currency || !billingInterval || !type || !pricingModel || !provider || !status) {
      setMessage("Producto, código, nombre, precio, moneda, intervalo, tipo, modelo, proveedor y estado son obligatorios.");
      return;
    }

    if (!Number.isInteger(minQuantity) || minQuantity < 1) {
      setMessage("Cantidad mínima debe ser un entero mayor o igual a 1.");
      return;
    }

    if (maxQuantity !== null && (!Number.isInteger(maxQuantity) || maxQuantity < minQuantity)) {
      setMessage("Cantidad máxima debe estar vacía o ser mayor o igual a la mínima.");
      return;
    }

    setSaving(true);
    setMessage("");

    try {
      await onSubmit({
        productId,
        code,
        name,
        description: stringValue(form, "description") ?? null,
        unitPrice,
        currency,
        billingInterval,
        type,
        pricingModel,
        minQuantity: pricingModel === "flat" ? 1 : minQuantity,
        maxQuantity: pricingModel === "flat" ? 1 : maxQuantity,
        provider,
        providerPlanId: stringValue(form, "providerPlanId") ?? null,
        entitlementEffects: { numeric: {}, features: {} },
        status,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el add-on.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="rounded-lg border border-border bg-card p-5 shadow-sm" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Producto
          <select className={selectClassName} defaultValue={productId} disabled={readOnly} name="productId" required>
            <option value="">Selecciona producto</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Código
          <Input defaultValue={initialAddon?.code ?? ""} maxLength={100} name="code" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Nombre
          <Input defaultValue={initialAddon?.name ?? ""} maxLength={120} name="name" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Precio unitario
          <Input defaultValue={initialAddon?.unitPrice ?? ""} inputMode="decimal" name="unitPrice" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Moneda
          <select className={selectClassName} defaultValue={initialAddon?.currency ?? "MXN"} disabled={readOnly} name="currency" required>
            {currencies.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Intervalo
          <select className={selectClassName} defaultValue={initialAddon?.billingInterval ?? "monthly"} disabled={readOnly} name="billingInterval" required>
            {intervals.map((interval) => <option key={interval} value={interval}>{interval}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Tipo
          <select className={selectClassName} defaultValue={initialAddon?.type ?? "recurring"} disabled={readOnly} name="type" required>
            {types.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Modelo de precio
          <select className={selectClassName} defaultValue={initialAddon?.pricingModel ?? "flat"} disabled={readOnly} name="pricingModel" required>
            {pricingModels.map((model) => <option key={model} value={model}>{model}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Cantidad mínima
          <Input defaultValue={initialAddon?.minQuantity ?? 1} min={1} name="minQuantity" readOnly={readOnly} required type="number" />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Cantidad máxima
          <Input defaultValue={initialAddon?.maxQuantity ?? ""} min={1} name="maxQuantity" readOnly={readOnly} type="number" />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Proveedor
          <select className={selectClassName} defaultValue={initialAddon?.provider ?? "paypal"} disabled={readOnly} name="provider" required>
            {providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Provider plan ID
          <Input defaultValue={initialAddon?.providerPlanId ?? ""} maxLength={150} name="providerPlanId" readOnly={readOnly} />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Estado
          <select className={selectClassName} defaultValue={initialAddon?.status ?? "active"} disabled={readOnly} name="status" required>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
            <option value="archived">archived</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Descripción
          <textarea className="min-h-24 rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={initialAddon?.description ?? ""} name="description" readOnly={readOnly} />
        </label>
      </div>

      {message ? <p className="mt-4 text-sm font-medium text-destructive">{message}</p> : null}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button render={<Link href={returnHref} />} variant="outline"><ArrowLeft className="size-4" />Volver</Button>
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
