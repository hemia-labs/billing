"use client";

import { type FormEvent, useState } from "react";
import Link from "next/link";
import { Save } from "lucide-react";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Card } from "@/components/zuno/card";
import { Input } from "@/components/zuno/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/zuno/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  BillingAddonPricingModel,
  BillingCurrency,
  BillingInterval,
  BillingProvider,
  CatalogAddon,
  CatalogAddonPayload,
  CatalogProduct,
} from "../catalog-api";

type Option = { value: string; label: string };

const currencyOptions: Option[] = [
  { value: "MXN", label: "MXN" },
  { value: "USD", label: "USD" },
];
const intervalOptions: Option[] = [
  { value: "monthly", label: "Mensual" },
  { value: "yearly", label: "Anual" },
];
const pricingOptions: Option[] = [
  { value: "flat", label: "Precio fijo" },
  { value: "per_unit", label: "Por unidad" },
];
const providerOptions: Option[] = [
  { value: "paypal", label: "PayPal" },
  { value: "stripe", label: "Stripe" },
  { value: "mercado_pago", label: "Mercado Pago" },
  { value: "manual_transfer", label: "Transferencia manual" },
];
const statusOptions: Option[] = [
  { value: "active", label: "Activo" },
  { value: "inactive", label: "Inactivo" },
  { value: "archived", label: "Archivado" },
];

export function AddonForm({
  defaultProductId,
  initialAddon,
  lockedProduct,
  onSubmit,
  products,
  readOnly = false,
  submitLabel,
}: {
  defaultProductId?: string;
  initialAddon?: CatalogAddon;
  lockedProduct?: CatalogProduct;
  onSubmit: (payload: CatalogAddonPayload) => Promise<void>;
  products: CatalogProduct[];
  readOnly?: boolean;
  submitLabel: string;
}) {
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [productId, setProductId] = useState(initialAddon?.productId ?? defaultProductId ?? "");
  const [currency, setCurrency] = useState<BillingCurrency>(initialAddon?.currency ?? "MXN");
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(initialAddon?.billingInterval ?? "monthly");
  const [pricingModel, setPricingModel] = useState<BillingAddonPricingModel>(initialAddon?.pricingModel ?? "flat");
  const [provider, setProvider] = useState<BillingProvider>(initialAddon?.provider ?? "paypal");
  const [status, setStatus] = useState<CatalogAddon["status"]>(initialAddon?.status ?? "active");
  const returnProductId = initialAddon?.productId ?? defaultProductId;
  const returnHref = returnProductId ? "/products/" + returnProductId + "?tab=addons" : "/products";
  const productOptions = products.map((product) => ({ value: product.id, label: product.name }));
  if (initialAddon && !productOptions.some((option) => option.value === initialAddon.productId)) {
    productOptions.unshift({ value: initialAddon.productId, label: initialAddon.productCode });
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;

    const form = new FormData(event.currentTarget);
    const selectedProductId = lockedProduct?.id ?? productId;
    const code = stringValue(form, "code");
    const name = stringValue(form, "name");
    const unitPrice = stringValue(form, "unitPrice");
    const minQuantity = pricingModel === "flat" ? 1 : Number(stringValue(form, "minQuantity") ?? 1);
    const rawMaxQuantity = pricingModel === "flat" ? undefined : stringValue(form, "maxQuantity");
    const maxQuantity = pricingModel === "flat" ? 1 : rawMaxQuantity ? Number(rawMaxQuantity) : null;

    if (!selectedProductId || !code || !name || !unitPrice) {
      setMessage("Completa el producto, código, nombre y precio.");
      return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(unitPrice) || Number(unitPrice) > 9999999999.99) {
      setMessage("Escribe un precio válido con hasta dos decimales.");
      return;
    }
    if (!Number.isInteger(minQuantity) || minQuantity < 1) {
      setMessage("La cantidad mínima debe ser un entero mayor o igual a 1.");
      return;
    }
    if (maxQuantity !== null && (!Number.isInteger(maxQuantity) || maxQuantity < minQuantity)) {
      setMessage("La cantidad máxima debe estar vacía o ser mayor o igual a la mínima.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      await onSubmit({
        productId: selectedProductId,
        code,
        name,
        description: stringValue(form, "description") ?? null,
        unitPrice,
        currency,
        billingInterval,
        type: "recurring",
        pricingModel,
        minQuantity,
        maxQuantity,
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
    <Card className="shadow-sm">
      <form className="space-y-7 p-5 md:p-6" noValidate onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-2">
          {lockedProduct ? (
            <dl className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Producto</dt>
              <dd className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {lockedProduct.name}
                <Badge variant="outline">{lockedProduct.code}</Badge>
              </dd>
            </dl>
          ) : (
            <div className="sm:col-span-2">
              <FormSelect disabled={readOnly} id="addon-product" label="Producto" onChange={setProductId} options={productOptions} placeholder="Selecciona un producto" value={productId} />
            </div>
          )}
          <label className="grid gap-2 text-sm font-medium">
            Nombre
            <Input defaultValue={initialAddon?.name ?? ""} maxLength={120} name="name" placeholder="Ej. Consultas adicionales" readOnly={readOnly} required />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Código
            <Input defaultValue={initialAddon?.code ?? ""} maxLength={100} name="code" placeholder="consultas_extra" readOnly={readOnly} required />
          </label>
          <label className="grid gap-2 text-sm font-medium sm:col-span-2">
            <span>Descripción <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
            <Textarea className="min-h-24" defaultValue={initialAddon?.description ?? ""} name="description" placeholder="Describe qué incluye este add-on" readOnly={readOnly} />
          </label>
        </div>

        <section aria-labelledby="addon-pricing-heading" className="space-y-4 border-t border-border pt-6">
          <div>
            <h2 className="text-base font-semibold" id="addon-pricing-heading">Precio y facturación</h2>
            <p className="mt-1 text-sm text-muted-foreground">Define el cobro recurrente y si el precio se aplica por unidad.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium">
              {pricingModel === "flat" ? "Precio" : "Precio por unidad"}
              <Input defaultValue={initialAddon?.unitPrice ?? ""} inputMode="decimal" name="unitPrice" placeholder="0.00" readOnly={readOnly} required />
            </label>
            <FormSelect disabled={readOnly} id="addon-currency" label="Moneda" onChange={(value) => setCurrency(value as BillingCurrency)} options={currencyOptions} value={currency} />
            <FormSelect disabled={readOnly} id="addon-interval" label="Intervalo" onChange={(value) => setBillingInterval(value as BillingInterval)} options={intervalOptions} value={billingInterval} />
            <FormSelect disabled={readOnly} id="addon-pricing-model" label="Modelo de precio" onChange={(value) => setPricingModel(value as BillingAddonPricingModel)} options={pricingOptions} value={pricingModel} />
            {pricingModel === "per_unit" ? (
              <>
                <label className="grid gap-2 text-sm font-medium">
                  Cantidad mínima
                  <Input defaultValue={initialAddon?.minQuantity ?? 1} min={1} name="minQuantity" readOnly={readOnly} required type="number" />
                </label>
                <label className="grid gap-2 text-sm font-medium">
                  <span>Cantidad máxima <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
                  <Input defaultValue={initialAddon?.maxQuantity ?? ""} min={1} name="maxQuantity" readOnly={readOnly} type="number" />
                </label>
              </>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="addon-provider-heading" className="space-y-4 border-t border-border pt-6">
          <div>
            <h2 className="text-base font-semibold" id="addon-provider-heading">Proveedor y estado</h2>
            <p className="mt-1 text-sm text-muted-foreground">Asocia el add-on con el proveedor de pagos y define su disponibilidad.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormSelect disabled={readOnly} id="addon-provider" label="Proveedor" onChange={(value) => setProvider(value as BillingProvider)} options={providerOptions} value={provider} />
            <FormSelect disabled={readOnly} id="addon-status" label="Estado" onChange={(value) => setStatus(value as CatalogAddon["status"])} options={statusOptions} value={status} />
            <label className="grid gap-2 text-sm font-medium sm:col-span-2">
              <span>ID del plan en el proveedor <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
              <Input defaultValue={initialAddon?.providerPlanId ?? ""} maxLength={150} name="providerPlanId" readOnly={readOnly} />
            </label>
          </div>
        </section>

        {message ? <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">{message}</p> : null}

        <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-5">
          <Button disabled={saving} render={<Link href={returnHref} />} type="button" variant="outline">{readOnly ? "Volver" : "Cancelar"}</Button>
          {!readOnly ? <Button loading={saving} type="submit"><Save className="size-4" />{submitLabel}</Button> : null}
        </div>
      </form>
    </Card>
  );
}

function FormSelect({
  disabled,
  id,
  label,
  onChange,
  options,
  placeholder = "Selecciona una opción",
  value,
}: {
  disabled: boolean;
  id: string;
  label: string;
  onChange: (value: string) => void;
  options: Option[];
  placeholder?: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <Select disabled={disabled} onValueChange={(next) => { if (typeof next === "string") onChange(next); }} value={value}>
        <SelectTrigger id={id}>
          <SelectValue>{(selected: string | null) => options.find((option) => option.value === selected)?.label ?? placeholder}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

function stringValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
