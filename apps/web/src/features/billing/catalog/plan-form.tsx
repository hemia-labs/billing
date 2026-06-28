"use client";

import { type FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BillingCurrency,
  BillingProvider,
  CatalogPlan,
  CatalogPlanPayload,
  CatalogProduct,
  FeatureAggregationStrategy,
  FeatureValueType,
  PlanPriceBillingInterval,
} from "./catalog-api";
import { primaryPrice, primaryProviderPrice, primaryVersion } from "./catalog-api";

type EntitlementDraft = {
  key: string;
  code: string;
  name: string;
  valueType: FeatureValueType;
  value: string;
  unit: string;
  aggregationStrategy: FeatureAggregationStrategy;
  isMetered: boolean;
};

type ParsedEntitlement = {
  code: string;
  name: string;
  valueType: FeatureValueType;
  valueJson: unknown;
  unit: string;
  aggregationStrategy: FeatureAggregationStrategy;
  isMetered: boolean;
};

const providers: BillingProvider[] = ["paypal", "stripe", "mercado_pago", "manual_transfer"];
const currencies: BillingCurrency[] = ["MXN", "USD"];
const intervals: PlanPriceBillingInterval[] = ["month", "year"];
const valueTypes: FeatureValueType[] = ["boolean", "integer", "decimal", "string", "json"];
const aggregationStrategies: FeatureAggregationStrategy[] = ["replace", "sum", "max", "min", "boolean_or", "boolean_and"];

export function PlanForm({
  defaultProductId,
  initialPlan,
  lockedProduct,
  onSubmit,
  products,
  readOnly = false,
  submitLabel,
}: {
  defaultProductId?: string;
  initialPlan?: CatalogPlan;
  lockedProduct?: CatalogProduct;
  onSubmit: (payload: CatalogPlanPayload) => Promise<void>;
  products: CatalogProduct[];
  readOnly?: boolean;
  submitLabel: string;
}) {
  const currentVersion = initialPlan ? primaryVersion(initialPlan) : undefined;
  const currentPrice = initialPlan ? primaryPrice(initialPlan) : undefined;
  const currentProviderPrice = initialPlan ? primaryProviderPrice(initialPlan) : undefined;
  const [entitlements, setEntitlements] = useState<EntitlementDraft[]>(() =>
    currentVersion?.entitlements.length
      ? currentVersion.entitlements.map((entitlement) => ({
          key: entitlement.id,
          code: entitlement.feature.code,
          name: entitlement.feature.name,
          valueType: entitlement.feature.valueType,
          value: formatValue(entitlement.valueJson),
          unit: entitlement.feature.unit ?? "",
          aggregationStrategy: entitlement.feature.aggregationStrategy,
          isMetered: entitlement.feature.isMetered,
        }))
      : [blankEntitlement()],
  );
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const productId = initialPlan?.productId ?? lockedProduct?.id ?? defaultProductId ?? "";
  const returnHref = productId ? `/products/${productId}?tab=plans` : "/products";
  const originalCommercial = useMemo(
    () => JSON.stringify(commercialSnapshot(currentPrice, currentProviderPrice, entitlementsFromVersion(currentVersion))),
    [currentPrice, currentProviderPrice, currentVersion],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;

    const form = new FormData(event.currentTarget);
    const productId = stringValue(form, "productId");
    const code = stringValue(form, "code");
    const name = stringValue(form, "name");
    const status = stringValue(form, "status") as CatalogPlan["status"] | undefined;
    const priceCode = stringValue(form, "priceCode");
    const billingInterval = stringValue(form, "billingInterval") as PlanPriceBillingInterval | undefined;
    const currency = stringValue(form, "currency") as BillingCurrency | undefined;
    const amount = stringValue(form, "amount");
    const provider = stringValue(form, "provider") as BillingProvider | undefined;

    if (!productId || !code || !name || !status) {
      setMessage("Producto, código, nombre y estado son obligatorios.");
      return;
    }

    if (!initialPlan && (!billingInterval || !currency || !amount || !provider)) {
      setMessage("Intervalo, moneda, precio y proveedor son obligatorios para crear el plan.");
      return;
    }

    const parsed = parseEntitlements(entitlements);
    if (parsed.error) {
      setMessage(parsed.error);
      return;
    }

    const nextCommercial = commercialSnapshot(
      {
        code: priceCode || `${code}_${billingInterval ?? "month"}_${(currency ?? "MXN").toLowerCase()}`,
        billingInterval: billingInterval ?? "month",
        billingIntervalCount: 1,
        currency: currency ?? "MXN",
        amount: amount ?? "0.00",
        status: "active",
      },
      {
        provider: provider ?? "paypal",
        providerProductId: stringValue(form, "providerProductId") ?? null,
        providerPriceId: stringValue(form, "providerPriceId") ?? null,
        status: "active",
      },
      parsed.items,
    );
    const includeVersion = !initialPlan || JSON.stringify(nextCommercial) !== originalCommercial;
    const nextPrice = nextCommercial.price;
    const nextProvider = nextCommercial.provider;
    if (includeVersion && (!nextPrice || !nextProvider)) {
      setMessage("Precio y proveedor son obligatorios.");
      return;
    }
    const versionPayload = includeVersion && nextPrice && nextProvider
      ? {
          features: parsed.items.map((item) => ({
            code: item.code,
            name: item.name,
            valueType: item.valueType,
            unit: item.unit || null,
            aggregationStrategy: item.aggregationStrategy,
            isMetered: item.isMetered,
          })),
          version: {
            version: initialPlan ? Math.max(0, ...initialPlan.versions.map((item) => item.version)) + 1 : 1,
            status: "published" as const,
            prices: [{
              code: nextPrice.code,
              billingInterval: nextPrice.billingInterval,
              billingIntervalCount: 1,
              currency: nextPrice.currency,
              amount: nextPrice.amount,
              status: "active" as const,
              providerPrices: [{
                provider: nextProvider.provider,
                providerProductId: nextProvider.providerProductId,
                providerPriceId: nextProvider.providerPriceId,
                providerMetadata: {},
                status: "active" as const,
              }],
            }],
            entitlements: parsed.items.map((item) => ({
              featureCode: item.code,
              valueJson: item.valueJson,
            })),
          },
        }
      : {};

    setSaving(true);
    setMessage("");

    try {
      await onSubmit({
        productId,
        code,
        name,
        description: stringValue(form, "description") ?? null,
        status,
        ...versionPayload,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el plan.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="space-y-5 rounded-lg border border-border bg-card p-5 shadow-sm" onSubmit={submit}>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold">
          Producto
          {lockedProduct ? (
            <>
              <input name="productId" type="hidden" value={lockedProduct.id} />
              <Input className={inputClassName} placeholder="Producto" readOnly value={lockedProduct.name} />
            </>
          ) : (
            <Select defaultValue={productId || undefined} disabled={readOnly} name="productId" required>
              <SelectTrigger className={selectTriggerClassName}><SelectValue placeholder="Selecciona producto" /></SelectTrigger>
              <SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Código
          <Input className={inputClassName} defaultValue={initialPlan?.code ?? ""} maxLength={100} name="code" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Nombre
          <Input className={inputClassName} defaultValue={initialPlan?.name ?? ""} maxLength={120} name="name" readOnly={readOnly} required />
        </label>
        <label className="grid gap-2 text-sm font-semibold">
          Estado
          <Select defaultValue={initialPlan?.status ?? "active"} disabled={readOnly} name="status" required>
            <SelectTrigger className={selectTriggerClassName}><SelectValue placeholder="Selecciona estado" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">active</SelectItem>
              <SelectItem value="archived">archived</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="grid gap-2 text-sm font-semibold md:col-span-2">
          Descripción
          <textarea className="min-h-24 rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50" defaultValue={initialPlan?.description ?? ""} name="description" readOnly={readOnly} />
        </label>
      </div>

      <section className="space-y-4 border-t border-border pt-5">
        <h2 className="text-base font-bold">Precio principal</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold">
            Código de precio
            <Input className={inputClassName} defaultValue={currentPrice?.code ?? ""} maxLength={100} name="priceCode" readOnly={readOnly} />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Intervalo
            <Select defaultValue={currentPrice?.billingInterval ?? "month"} disabled={readOnly} name="billingInterval">
              <SelectTrigger className={selectTriggerClassName}><SelectValue placeholder="Selecciona intervalo" /></SelectTrigger>
              <SelectContent>{intervals.map((interval) => <SelectItem key={interval} value={interval}>{interval}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Moneda
            <Select defaultValue={currentPrice?.currency ?? "MXN"} disabled={readOnly} name="currency">
              <SelectTrigger className={selectTriggerClassName}><SelectValue placeholder="Selecciona moneda" /></SelectTrigger>
              <SelectContent>{currencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Precio
            <Input className={inputClassName} defaultValue={currentPrice?.amount ?? ""} inputMode="decimal" name="amount" readOnly={readOnly} />
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Proveedor
            <Select defaultValue={currentProviderPrice?.provider ?? "paypal"} disabled={readOnly} name="provider">
              <SelectTrigger className={selectTriggerClassName}><SelectValue placeholder="Selecciona proveedor" /></SelectTrigger>
              <SelectContent>{providers.map((provider) => <SelectItem key={provider} value={provider}>{provider}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="grid gap-2 text-sm font-semibold">
            Provider product ID
            <Input className={inputClassName} defaultValue={currentProviderPrice?.providerProductId ?? ""} maxLength={150} name="providerProductId" readOnly={readOnly} />
          </label>
          <label className="grid gap-2 text-sm font-semibold md:col-span-2">
            Provider price ID
            <Input className={inputClassName} defaultValue={currentProviderPrice?.providerPriceId ?? ""} maxLength={150} name="providerPriceId" readOnly={readOnly} />
          </label>
        </div>
      </section>

      <section className="space-y-4 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">Features y entitlements</h2>
          {!readOnly ? (
            <Button className="h-12" onClick={() => setEntitlements((items) => [...items, blankEntitlement()])} type="button" variant="outline">
              <Plus className="size-4" />Agregar
            </Button>
          ) : null}
        </div>
        <div className="space-y-3">
          {entitlements.map((item, index) => (
            <div className="grid gap-3 rounded-lg border border-border bg-background p-4 lg:grid-cols-6" key={item.key}>
              <Input className={inputClassName} onChange={(event) => updateEntitlement(index, "code", event.target.value, setEntitlements)} placeholder="feature.code" readOnly={readOnly} value={item.code} />
              <Input className={inputClassName} onChange={(event) => updateEntitlement(index, "name", event.target.value, setEntitlements)} placeholder="Nombre" readOnly={readOnly} value={item.name} />
              <Select disabled={readOnly} onValueChange={(value) => updateEntitlement(index, "valueType", value as FeatureValueType, setEntitlements)} value={item.valueType}>
                <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                <SelectContent>{valueTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
              </Select>
              <Input className={inputClassName} onChange={(event) => updateEntitlement(index, "value", event.target.value, setEntitlements)} placeholder="Valor" readOnly={readOnly} value={item.value} />
              <Select disabled={readOnly} onValueChange={(value) => updateEntitlement(index, "aggregationStrategy", value as FeatureAggregationStrategy, setEntitlements)} value={item.aggregationStrategy}>
                <SelectTrigger className={selectTriggerClassName}><SelectValue /></SelectTrigger>
                <SelectContent>{aggregationStrategies.map((strategy) => <SelectItem key={strategy} value={strategy}>{strategy}</SelectItem>)}</SelectContent>
              </Select>
              <div className="flex gap-2">
                <Input className={inputClassName} onChange={(event) => updateEntitlement(index, "unit", event.target.value, setEntitlements)} placeholder="Unidad" readOnly={readOnly} value={item.unit} />
                {!readOnly ? (
                  <Button aria-label="Quitar feature" className="size-12 shrink-0" onClick={() => setEntitlements((items) => items.filter((_, itemIndex) => itemIndex !== index))} size="icon" type="button" variant="outline">
                    <Trash2 className="size-4" />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      {message ? <p className="text-sm font-medium text-destructive">{message}</p> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button className="h-12" render={<Link href={returnHref} />} variant="outline"><ArrowLeft className="size-4" />Volver</Button>
        {!readOnly ? (
          <Button className="h-12" disabled={saving} type="submit"><Save className="size-4" />{saving ? "Guardando..." : submitLabel}</Button>
        ) : null}
      </div>
    </form>
  );
}

function updateEntitlement<K extends keyof EntitlementDraft>(
  index: number,
  key: K,
  value: EntitlementDraft[K],
  setEntitlements: (update: (items: EntitlementDraft[]) => EntitlementDraft[]) => void,
) {
  setEntitlements((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
}

function parseEntitlements(items: EntitlementDraft[]) {
  const parsed: ParsedEntitlement[] = [];
  for (const item of items.filter((entry) => entry.code.trim())) {
    const valueJson = parseValue(item.valueType, item.value);
    if (valueJson instanceof Error) return { error: `${item.code}: ${valueJson.message}`, items: [] };
    parsed.push({
      code: item.code.trim(),
      name: item.name.trim() || item.code.trim(),
      valueType: item.valueType,
      valueJson,
      unit: item.unit.trim(),
      aggregationStrategy: item.aggregationStrategy,
      isMetered: item.isMetered,
    });
  }
  return { items: parsed };
}

function parseValue(type: FeatureValueType, value: string) {
  if (type === "boolean") return value === "true" || value.toLowerCase() === "sí" || value.toLowerCase() === "si";
  if (type === "integer") {
    const number = Number(value);
    return Number.isInteger(number) ? number : new Error("debe ser entero");
  }
  if (type === "decimal") {
    const number = Number(value);
    return Number.isFinite(number) ? number : new Error("debe ser decimal");
  }
  if (type === "json") {
    try {
      return JSON.parse(value);
    } catch {
      return new Error("debe ser JSON válido");
    }
  }
  return value;
}

function formatValue(value: unknown) {
  if (typeof value === "object") return JSON.stringify(value);
  return String(value ?? "");
}

function entitlementsFromVersion(version: ReturnType<typeof primaryVersion> | undefined): EntitlementDraft[] {
  return version?.entitlements.map((entitlement) => ({
    key: entitlement.id,
    code: entitlement.feature.code,
    name: entitlement.feature.name,
    valueType: entitlement.feature.valueType,
    value: formatValue(entitlement.valueJson),
    unit: entitlement.feature.unit ?? "",
    aggregationStrategy: entitlement.feature.aggregationStrategy,
    isMetered: entitlement.feature.isMetered,
  })) ?? [];
}

function commercialSnapshot(
  price: { code: string; billingInterval: PlanPriceBillingInterval; billingIntervalCount: number; currency: BillingCurrency; amount: string; status: string } | undefined,
  provider: { provider: BillingProvider; providerProductId: string | null; providerPriceId: string | null; status: string } | undefined,
  entitlements: Array<EntitlementDraft | ParsedEntitlement>,
) {
  return {
    price: price ? {
      code: price.code,
      billingInterval: price.billingInterval,
      billingIntervalCount: price.billingIntervalCount,
      currency: price.currency,
      amount: price.amount,
      status: price.status,
    } : null,
    provider: provider ? {
      provider: provider.provider,
      providerProductId: provider.providerProductId,
      providerPriceId: provider.providerPriceId,
      status: provider.status,
    } : null,
    entitlements: entitlements.map((item) => ({
      code: item.code,
      name: item.name,
      valueType: item.valueType,
      value: "valueJson" in item ? formatValue(item.valueJson) : item.value,
      unit: item.unit,
      aggregationStrategy: item.aggregationStrategy,
      isMetered: item.isMetered,
    })),
  };
}

function blankEntitlement(): EntitlementDraft {
  return {
    key: crypto.randomUUID(),
    code: "",
    name: "",
    valueType: "boolean",
    value: "true",
    unit: "",
    aggregationStrategy: "replace",
    isMetered: false,
  };
}

function stringValue(form: FormData, key: string) {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const inputClassName = "h-12 bg-card font-normal";
const selectTriggerClassName = "!h-12 w-full bg-card font-normal";
