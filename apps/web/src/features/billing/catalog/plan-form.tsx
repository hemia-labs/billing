"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/zuno/button";
import { Card } from "@/components/zuno/card";
import { Switch } from "@/components/zuno/switch";
import { Input } from "@/components/zuno/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/zuno/select";
import type {
  BillingCurrency,
  BillingProvider,
  CatalogPlan,
  CatalogPlanPayload,
  CatalogPlanPrice,
  CatalogPlanPricePayload,
  CatalogProduct,
  FeatureAggregationStrategy,
  FeatureValueType,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  ProviderPriceStatus,
} from "./catalog-api";
import { primaryVersion } from "./catalog-api";

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

type ProviderPriceDraft = {
  key: string;
  provider: BillingProvider;
  providerProductId: string;
  providerPriceId: string;
  providerMetadata: Record<string, unknown>;
  status: ProviderPriceStatus;
};

type PriceDraft = {
  key: string;
  code: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  currency: BillingCurrency;
  amount: string;
  status: PlanPriceStatus;
  providerPrices: ProviderPriceDraft[];
};

const providers: BillingProvider[] = ["paypal", "stripe", "mercado_pago", "manual_transfer"];
const providerLabels: Record<BillingProvider, string> = { paypal: "PayPal", stripe: "Stripe", mercado_pago: "Mercado Pago", manual_transfer: "Transferencia" };
const currencies: BillingCurrency[] = ["MXN", "USD"];
const intervals: PlanPriceBillingInterval[] = ["month", "year"];
const valueTypes: FeatureValueType[] = ["boolean", "integer", "decimal", "string", "json"];
const aggregationStrategies: FeatureAggregationStrategy[] = ["replace", "sum", "max", "min", "boolean_or", "boolean_and"];

export function PlanForm({
  cancelHref,
  defaultProductId,
  initialPlan,
  lockedProduct,
  onSubmit,
  products,
  readOnly = false,
  submitLabel,
}: {
  cancelHref?: string;
  defaultProductId?: string;
  initialPlan?: CatalogPlan;
  lockedProduct?: CatalogProduct;
  onSubmit: (payload: CatalogPlanPayload) => Promise<void>;
  products: CatalogProduct[];
  readOnly?: boolean;
  submitLabel: string;
}) {
  const isNew = !initialPlan;
  const currentVersion = initialPlan
    ? [...initialPlan.versions].filter((version) => version.status === "draft")
        .sort((left, right) => right.version - left.version)[0] ?? primaryVersion(initialPlan)
    : undefined;
  const [prices, setPrices] = useState<PriceDraft[]>(() =>
    currentVersion?.prices.length ? currentVersion.prices.map(priceDraftFromCatalog) : [blankPrice()],
  );
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
      : [],
  );
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [expandedPriceOptions, setExpandedPriceOptions] = useState<Record<string, boolean>>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const productId = initialPlan?.productId ?? lockedProduct?.id ?? defaultProductId ?? "";
  const returnHref = cancelHref ?? (productId ? `/products/${productId}?tab=plans` : "/products");
  const originalCommercial = useMemo(
    () => JSON.stringify(commercialSnapshot(
      currentVersion?.prices.map(pricePayload) ?? [],
      entitlementsFromVersion(currentVersion),
    )),
    [currentVersion],
  );

  const clearError = (id: string) => {
    setFieldErrors((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const focusErrors = () => requestAnimationFrame(() => errorRef.current?.focus());

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (readOnly) return;

    const form = new FormData(event.currentTarget);
    const productId = stringValue(form, "productId");
    const code = stringValue(form, "code");
    const name = stringValue(form, "name");
    const status = (stringValue(form, "status") ?? (isNew ? "active" : undefined)) as CatalogPlan["status"] | undefined;
    const errors: Record<string, string> = {};
    if (!productId) errors["plan-product"] = "Selecciona un producto.";
    if (!name) errors["plan-name"] = "Escribe el nombre del plan.";
    if (!code) errors["plan-code"] = "Escribe el código del plan.";
    if (!status) errors["plan-status"] = "Selecciona el estado del plan.";

    const parsed = parseEntitlements(entitlements);
    if (parsed.error) errors["plan-features"] = parsed.error;

    const nextPrices = prices.map((price) => {
      const payload = pricePayload(price);
      return {
        ...payload,
        code: payload.code || `${code ?? "plan"}_${price.billingInterval}_${price.currency.toLowerCase()}`,
      };
    });
    if (!nextPrices.length) errors["plan-prices"] = "Agrega al menos un precio.";
    prices.forEach((price, index) => {
      if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(price.amount.trim())) {
        errors[`price-${index}-amount`] = "Escribe un importe válido con hasta dos decimales.";
      }
      if (!Number.isInteger(price.billingIntervalCount) || price.billingIntervalCount < 1) {
        errors[`price-${index}-count`] = "La cantidad de intervalos debe ser al menos 1.";
      }
    });
    if (new Set(nextPrices.map((price) => price.code)).size !== nextPrices.length) {
      errors["plan-prices"] = "Los códigos de precio deben ser únicos. Cambia el intervalo, la moneda o el código.";
    }
    if (Object.keys(errors).length) {
      const invalidCounts = prices.filter((_, index) => errors[`price-${index}-count`]);
      if (invalidCounts.length) {
        setExpandedPriceOptions((current) => ({
          ...current,
          ...Object.fromEntries(invalidCounts.map((price) => [price.key, true])),
        }));
      }
      setMessage("");
      setFieldErrors(errors);
      focusErrors();
      return;
    }

    const nextCommercial = commercialSnapshot(nextPrices, parsed.items);
    const includeVersion = !initialPlan || JSON.stringify(nextCommercial) !== originalCommercial;
    const versionPayload: Pick<CatalogPlanPayload, "features" | "version"> = includeVersion
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
            status: "draft",
            prices: nextPrices,
            entitlements: parsed.items.map((item) => ({
              featureCode: item.code,
              valueJson: item.valueJson,
            })),
          },
        }
      : {};

    setSaving(true);
    setMessage("");
    setFieldErrors({});

    try {
      await onSubmit({
        productId: productId!,
        code: code!,
        name: name!,
        description: stringValue(form, "description") ?? null,
        status: status!,
        ...versionPayload,
      });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el plan.");
      focusErrors();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <form className="space-y-7 p-5 md:p-6" noValidate onSubmit={submit}>
        {(message || Object.keys(fieldErrors).length > 0) && (
          <div
            className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground outline-none"
            ref={errorRef}
            role="alert"
            tabIndex={-1}
          >
            <p className="font-semibold">{message ? "No se pudo guardar el plan" : "Revisa estos campos"}</p>
            {message ? <p className="mt-1">{message}</p> : (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {Object.entries(fieldErrors).map(([id, error]) => (
                  <li key={id}><a className="underline underline-offset-2" href={"#" + id}>{error}</a></li>
                ))}
              </ul>
            )}
          </div>
        )}

        <section aria-labelledby="plan-details-heading" className="space-y-4">
          <div>
            <h2 className="text-base font-semibold" id="plan-details-heading">Datos del plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">Define cómo se identificará este plan en el catálogo.</p>
          </div>
          {lockedProduct ? (
            <input name="productId" type="hidden" value={lockedProduct.id} />
          ) : (
            <label className="grid gap-2 text-sm font-medium" htmlFor="plan-product">
              Producto
              <Select defaultValue={productId || undefined} disabled={readOnly} name="productId" onValueChange={() => clearError("plan-product")} required>
                <SelectTrigger aria-invalid={Boolean(fieldErrors["plan-product"])} className={selectTriggerClassName} id="plan-product">
                  <SelectValue placeholder="Selecciona producto" />
                </SelectTrigger>
                <SelectContent>{products.map((product) => <SelectItem key={product.id} value={product.id}>{product.name}</SelectItem>)}</SelectContent>
              </Select>
              {fieldErrors["plan-product"] && <span className="text-xs text-destructive">{fieldErrors["plan-product"]}</span>}
            </label>
          )}
          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <label className="grid gap-2 text-sm font-medium" htmlFor="plan-name">
              Nombre
              <Input
                aria-invalid={Boolean(fieldErrors["plan-name"])}
                className={inputClassName}
                defaultValue={initialPlan?.name ?? ""}
                id="plan-name"
                maxLength={120}
                name="name"
                onChange={() => clearError("plan-name")}
                readOnly={readOnly}
                required
              />
              {fieldErrors["plan-name"] && <span className="text-xs text-destructive">{fieldErrors["plan-name"]}</span>}
            </label>
            <label className="grid gap-2 text-sm font-medium" htmlFor="plan-code">
              Código
              <Input
                aria-invalid={Boolean(fieldErrors["plan-code"])}
                className={inputClassName}
                defaultValue={initialPlan?.code ?? ""}
                id="plan-code"
                maxLength={100}
                name="code"
                onChange={() => clearError("plan-code")}
                readOnly={readOnly}
                required
              />
              {fieldErrors["plan-code"] ? <span className="text-xs text-destructive">{fieldErrors["plan-code"]}</span> : (
                <span className="text-xs font-normal text-muted-foreground">Identificador interno, por ejemplo plan_basico.</span>
              )}
            </label>
          </div>
          <label className="grid gap-2 text-sm font-medium" htmlFor="plan-description">
            <span>Descripción <span className="text-xs font-normal text-muted-foreground">(opcional)</span></span>
            <textarea
              className="min-h-24 rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
              defaultValue={initialPlan?.description ?? ""}
              id="plan-description"
              name="description"
              readOnly={readOnly}
            />
          </label>
          {isNew ? <input name="status" type="hidden" value="active" /> : (
            <label className="grid max-w-xs gap-2 text-sm font-medium" htmlFor="plan-status">
              Estado
              <Select defaultValue={initialPlan?.status ?? "active"} disabled={readOnly} name="status" required>
                <SelectTrigger className={selectTriggerClassName} id="plan-status">
                  <SelectValue>{(value: string | null) => value === "active" ? "Activo" : value === "archived" ? "Archivado" : "Selecciona estado"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Activo</SelectItem>
                  <SelectItem value="archived">Archivado</SelectItem>
                </SelectContent>
              </Select>
            </label>
          )}
        </section>

        <section aria-labelledby="plan-prices-heading" className="space-y-4 border-t border-border pt-6" id="plan-prices">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" id="plan-prices-heading">Precios y proveedores</h2>
              <p className="mt-1 text-sm text-muted-foreground">{isNew ? "Agrega al menos un precio. Podrás publicar esta versión después de crearla." : "Configura los precios y proveedores del plan."}</p>
            </div>
            {!readOnly && (
              <Button onClick={() => setPrices((items) => [...items, blankPrice()])} type="button" variant="outline">
                <Plus className="size-4" />Agregar precio
              </Button>
            )}
          </div>
          {fieldErrors["plan-prices"] && <p className="text-sm text-destructive">{fieldErrors["plan-prices"]}</p>}
          {prices.map((price, priceIndex) => {
            const advancedPriceFields = (
              <div className="grid items-start gap-4 pt-4 md:grid-cols-3">
                <label className="grid gap-2 text-sm font-medium" htmlFor={"price-" + priceIndex + "-code"}>
                  Código de precio
                  <Input
                    className={inputClassName}
                    id={"price-" + priceIndex + "-code"}
                    maxLength={100}
                    onChange={(event) => { updatePrice(priceIndex, "code", event.target.value, setPrices); clearError("plan-prices"); }}
                    placeholder="Se genera automáticamente"
                    readOnly={readOnly}
                    value={price.code}
                  />
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor={"price-" + priceIndex + "-count"}>
                  Cobrar cada cuántos intervalos
                  <Input
                    aria-invalid={Boolean(fieldErrors["price-" + priceIndex + "-count"])}
                    className={inputClassName}
                    id={"price-" + priceIndex + "-count"}
                    min={1}
                    onChange={(event) => { updatePrice(priceIndex, "billingIntervalCount", Number(event.target.value), setPrices); clearError("price-" + priceIndex + "-count"); }}
                    readOnly={readOnly}
                    required
                    step={1}
                    type="number"
                    value={price.billingIntervalCount}
                  />
                  {fieldErrors["price-" + priceIndex + "-count"] && <span className="text-xs text-destructive">{fieldErrors["price-" + priceIndex + "-count"]}</span>}
                </label>
                <label className="grid gap-2 text-sm font-medium" htmlFor={"price-" + priceIndex + "-status"}>
                  Estado del precio
                  <Select disabled={readOnly} onValueChange={(value) => updatePrice(priceIndex, "status", value as PlanPriceStatus, setPrices)} value={price.status}>
                    <SelectTrigger className={selectTriggerClassName} id={"price-" + priceIndex + "-status"}>
                      <SelectValue>{(value: string | null) => value === "active" ? "Activo" : value === "archived" ? "Archivado" : "Selecciona estado"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent><SelectItem value="active">Activo</SelectItem><SelectItem value="archived">Archivado</SelectItem></SelectContent>
                  </Select>
                </label>
              </div>
            );
            return (
              <div className="space-y-5 rounded-lg border border-border bg-muted/15 p-4" key={price.key}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-semibold">Precio {priceIndex + 1}</h3>
                  {!readOnly && prices.length > 1 && (
                    <Button aria-label={"Quitar precio " + (priceIndex + 1)} onClick={() => { setPrices((items) => items.filter((_, index) => index !== priceIndex)); setFieldErrors({}); }} size="icon" type="button" variant="outline">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_9rem_12rem]">
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"price-" + priceIndex + "-amount"}>
                    Importe
                    <Input
                      aria-invalid={Boolean(fieldErrors["price-" + priceIndex + "-amount"])}
                      className={inputClassName}
                      id={"price-" + priceIndex + "-amount"}
                      inputMode="decimal"
                      onChange={(event) => { updatePrice(priceIndex, "amount", event.target.value, setPrices); clearError("price-" + priceIndex + "-amount"); }}
                      placeholder="0.00"
                      readOnly={readOnly}
                      required
                      value={price.amount}
                    />
                    {fieldErrors["price-" + priceIndex + "-amount"] && <span className="text-xs text-destructive">{fieldErrors["price-" + priceIndex + "-amount"]}</span>}
                  </label>
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"price-" + priceIndex + "-currency"}>
                    Moneda
                    <Select disabled={readOnly} onValueChange={(value) => { updatePrice(priceIndex, "currency", value as BillingCurrency, setPrices); clearError("plan-prices"); }} value={price.currency}>
                      <SelectTrigger className={selectTriggerClassName} id={"price-" + priceIndex + "-currency"}><SelectValue /></SelectTrigger>
                      <SelectContent>{currencies.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium sm:col-span-2 lg:col-span-1" htmlFor={"price-" + priceIndex + "-interval"}>
                    Frecuencia
                    <Select disabled={readOnly} onValueChange={(value) => { updatePrice(priceIndex, "billingInterval", value as PlanPriceBillingInterval, setPrices); clearError("plan-prices"); }} value={price.billingInterval}>
                      <SelectTrigger className={selectTriggerClassName} id={"price-" + priceIndex + "-interval"}>
                        <SelectValue>{(value: string | null) => value === "month" ? "Mensual" : value === "year" ? "Anual" : "Selecciona frecuencia"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>{intervals.map((interval) => <SelectItem key={interval} value={interval}>{interval === "month" ? "Mensual" : "Anual"}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                </div>
                {isNew ? (
                  <details
                    className="border-t border-border pt-4"
                    onToggle={(event) => {
                      const open = event.currentTarget.open;
                      setExpandedPriceOptions((current) => current[price.key] === open ? current : { ...current, [price.key]: open });
                    }}
                    open={Boolean(expandedPriceOptions[price.key])}
                  >
                    <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">Opciones avanzadas del precio</summary>
                    {advancedPriceFields}
                  </details>
                ) : <div className="border-t border-border">{advancedPriceFields}</div>}

                <div className="space-y-3 border-t border-border pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h4 className="text-sm font-semibold">Proveedores</h4>
                    {!readOnly && (
                      <Button onClick={() => setPrices((items) => items.map((item, index) => index === priceIndex ? { ...item, providerPrices: [...item.providerPrices, blankProviderPrice()] } : item))} type="button" variant="outline">
                        <Plus className="size-4" />Agregar proveedor
                      </Button>
                    )}
                  </div>
                  {!price.providerPrices.length && <p className="text-sm text-muted-foreground">Sin proveedores configurados.</p>}
                  {price.providerPrices.map((providerPrice, providerIndex) => {
                    const advancedProviderFields = (
                      <div className="grid items-start gap-4 pt-4 md:grid-cols-2">
                        <label className="grid gap-2 text-sm font-medium" htmlFor={"provider-" + priceIndex + "-" + providerIndex + "-product"}>
                          ID de producto del proveedor
                          <Input className={inputClassName} id={"provider-" + priceIndex + "-" + providerIndex + "-product"} maxLength={150} onChange={(event) => updateProviderPrice(priceIndex, providerIndex, "providerProductId", event.target.value, setPrices)} readOnly={readOnly} value={providerPrice.providerProductId} />
                        </label>
                        <label className="grid gap-2 text-sm font-medium" htmlFor={"provider-" + priceIndex + "-" + providerIndex + "-price"}>
                          ID de precio del proveedor
                          <Input className={inputClassName} id={"provider-" + priceIndex + "-" + providerIndex + "-price"} maxLength={150} onChange={(event) => updateProviderPrice(priceIndex, providerIndex, "providerPriceId", event.target.value, setPrices)} readOnly={readOnly} value={providerPrice.providerPriceId} />
                        </label>
                        <label className="grid gap-2 text-sm font-medium md:col-span-2" htmlFor={"provider-" + priceIndex + "-" + providerIndex + "-status"}>
                          Estado del proveedor
                          <Select disabled={readOnly} onValueChange={(value) => updateProviderPrice(priceIndex, providerIndex, "status", value as ProviderPriceStatus, setPrices)} value={providerPrice.status}>
                            <SelectTrigger className={selectTriggerClassName} id={"provider-" + priceIndex + "-" + providerIndex + "-status"}>
                              <SelectValue>{(value: string | null) => value === "active" ? "Activo" : value === "archived" ? "Archivado" : "Selecciona estado"}</SelectValue>
                            </SelectTrigger>
                            <SelectContent><SelectItem value="active">Activo</SelectItem><SelectItem value="archived">Archivado</SelectItem></SelectContent>
                          </Select>
                        </label>
                      </div>
                    );
                    return (
                      <div className="border-t border-border pt-3 first:border-t-0 first:pt-0" key={providerPrice.key}>
                        <div className="flex items-end gap-3">
                          <label className="grid min-w-0 flex-1 gap-2 text-sm font-medium" htmlFor={"provider-" + priceIndex + "-" + providerIndex}>
                            Proveedor {providerIndex + 1}
                            <Select disabled={readOnly} onValueChange={(value) => updateProviderPrice(priceIndex, providerIndex, "provider", value as BillingProvider, setPrices)} value={providerPrice.provider}>
                              <SelectTrigger className={selectTriggerClassName} id={"provider-" + priceIndex + "-" + providerIndex}>
                                <SelectValue>{(value: BillingProvider | null) => value ? providerLabels[value] : "Selecciona proveedor"}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>{providers.map((provider) => <SelectItem key={provider} value={provider}>{providerLabels[provider]}</SelectItem>)}</SelectContent>
                            </Select>
                          </label>
                          {!readOnly && (
                            <Button aria-label={"Quitar proveedor " + (providerIndex + 1) + " del precio " + (priceIndex + 1)} onClick={() => setPrices((items) => items.map((item, index) => index === priceIndex ? { ...item, providerPrices: item.providerPrices.filter((_, currentIndex) => currentIndex !== providerIndex) } : item))} size="icon" type="button" variant="outline">
                              <Trash2 className="size-4" />
                            </Button>
                          )}
                        </div>
                        {isNew ? (
                          <details className="mt-3">
                            <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">IDs y configuración del proveedor</summary>
                            {advancedProviderFields}
                          </details>
                        ) : advancedProviderFields}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </section>

        <section aria-labelledby="plan-features-heading" className="space-y-4 border-t border-border pt-6" id="plan-features">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold" id="plan-features-heading">Características del plan</h2>
              <p className="mt-1 text-sm text-muted-foreground">Añade los beneficios o límites que incluye el plan.</p>
            </div>
            {!readOnly && (
              <Button onClick={() => setEntitlements((items) => [...items, blankEntitlement()])} type="button" variant="outline">
                <Plus className="size-4" />Agregar característica
              </Button>
            )}
          </div>
          {fieldErrors["plan-features"] && <p className="text-sm text-destructive">{fieldErrors["plan-features"]}</p>}
          {!entitlements.length && <p className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">Aún no hay características. Puedes agregarlas ahora o después de crear el borrador.</p>}
          <div className="space-y-3">
            {entitlements.map((item, index) => (
              <div className="space-y-4 rounded-lg border border-border p-4" key={item.key}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Característica {index + 1}</h3>
                  {!readOnly && (
                    <Button aria-label={"Quitar característica " + (index + 1)} onClick={() => { setEntitlements((items) => items.filter((_, itemIndex) => itemIndex !== index)); clearError("plan-features"); }} size="icon" type="button" variant="outline">
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="grid items-start gap-4 md:grid-cols-2">
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-name"}>
                    Nombre
                    <Input className={inputClassName} id={"feature-" + index + "-name"} onChange={(event) => { updateEntitlement(index, "name", event.target.value, setEntitlements); clearError("plan-features"); }} readOnly={readOnly} value={item.name} />
                  </label>
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-code"}>
                    Código
                    <Input className={inputClassName} id={"feature-" + index + "-code"} onChange={(event) => { updateEntitlement(index, "code", event.target.value, setEntitlements); clearError("plan-features"); }} placeholder="feature.code" readOnly={readOnly} value={item.code} />
                  </label>
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-type"}>
                    Tipo de valor
                    <Select disabled={readOnly} onValueChange={(value) => {
                      setEntitlements((items) => items.map((entry, currentIndex) => currentIndex === index
                        ? { ...entry, valueType: value as FeatureValueType, value: value === "boolean" ? "true" : "" }
                        : entry));
                      clearError("plan-features");
                    }} value={item.valueType}>
                      <SelectTrigger className={selectTriggerClassName} id={"feature-" + index + "-type"}><SelectValue /></SelectTrigger>
                      <SelectContent>{valueTypes.map((type) => <SelectItem key={type} value={type}>{type}</SelectItem>)}</SelectContent>
                    </Select>
                  </label>
                  <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-value"}>
                    Valor
                    {item.valueType === "boolean" ? (
                      <Select disabled={readOnly} onValueChange={(value) => { updateEntitlement(index, "value", value ?? "false", setEntitlements); clearError("plan-features"); }} value={item.value}>
                        <SelectTrigger className={selectTriggerClassName} id={"feature-" + index + "-value"}>
                          <SelectValue>{(value: string | null) => value === "true" ? "Sí" : "No"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent><SelectItem value="true">Sí</SelectItem><SelectItem value="false">No</SelectItem></SelectContent>
                      </Select>
                    ) : item.valueType === "json" ? (
                      <textarea className="min-h-20 rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50" id={"feature-" + index + "-value"} onChange={(event) => { updateEntitlement(index, "value", event.target.value, setEntitlements); clearError("plan-features"); }} readOnly={readOnly} value={item.value} />
                    ) : (
                      <Input className={inputClassName} id={"feature-" + index + "-value"} onChange={(event) => { updateEntitlement(index, "value", event.target.value, setEntitlements); clearError("plan-features"); }} readOnly={readOnly} value={item.value} />
                    )}
                  </label>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Opciones avanzadas de la característica</summary>
                  <div className="grid items-start gap-4 pt-4 md:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-strategy"}>
                      Agregación
                      <Select disabled={readOnly} onValueChange={(value) => updateEntitlement(index, "aggregationStrategy", value as FeatureAggregationStrategy, setEntitlements)} value={item.aggregationStrategy}>
                        <SelectTrigger className={selectTriggerClassName} id={"feature-" + index + "-strategy"}><SelectValue /></SelectTrigger>
                        <SelectContent>{aggregationStrategies.map((strategy) => <SelectItem key={strategy} value={strategy}>{strategy}</SelectItem>)}</SelectContent>
                      </Select>
                    </label>
                    <label className="grid gap-2 text-sm font-medium" htmlFor={"feature-" + index + "-unit"}>
                      Unidad
                      <Input className={inputClassName} id={"feature-" + index + "-unit"} onChange={(event) => updateEntitlement(index, "unit", event.target.value, setEntitlements)} readOnly={readOnly} value={item.unit} />
                    </label>
                    <label className="flex items-center gap-3 text-sm font-medium md:col-span-2">
                      <Switch aria-label="Uso medido" checked={item.isMetered} disabled={readOnly} onCheckedChange={(value) => updateEntitlement(index, "isMetered", value, setEntitlements)} />
                      Uso medido
                    </label>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </section>

        <div className="sticky bottom-0 z-10 -mx-5 -mb-5 flex flex-wrap justify-end gap-2 rounded-b-xl border-t border-border bg-card/95 px-5 py-3 backdrop-blur md:-mx-6 md:-mb-6 md:px-6">
          <Button render={<Link href={returnHref} />} type="button" variant="outline">Cancelar</Button>
          {!readOnly && <Button disabled={saving} type="submit"><Save className="size-4" />{saving ? "Guardando..." : submitLabel}</Button>}
        </div>
      </form>
    </Card>
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
  const codes = new Set<string>();
  for (const item of items) {
    const code = item.code.trim();
    if (!code) return { error: "Escribe el código de cada característica o elimina la fila.", items: [] };
    if (codes.has(code)) return { error: `El código ${code} está repetido.`, items: [] };
    codes.add(code);
    const valueJson = parseValue(item.valueType, item.value);
    if (valueJson instanceof Error) return { error: `${code}: ${valueJson.message}`, items: [] };
    parsed.push({
      code,
      name: item.name.trim() || code,
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
    if (!value.trim()) return new Error("debe tener un valor entero");
    const number = Number(value);
    return Number.isInteger(number) ? number : new Error("debe ser entero");
  }
  if (type === "decimal") {
    if (!value.trim()) return new Error("debe tener un valor decimal");
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

function priceDraftFromCatalog(price: CatalogPlanPrice): PriceDraft {
  return {
    key: price.id,
    code: price.code,
    billingInterval: price.billingInterval,
    billingIntervalCount: price.billingIntervalCount,
    currency: price.currency,
    amount: price.amount,
    status: price.status,
    providerPrices: price.providerPrices.map((providerPrice) => ({
      key: providerPrice.id,
      provider: providerPrice.provider,
      providerProductId: providerPrice.providerProductId ?? "",
      providerPriceId: providerPrice.providerPriceId ?? "",
      providerMetadata: providerPrice.providerMetadata ?? {},
      status: providerPrice.status,
    })),
  };
}

function pricePayload(price: PriceDraft | CatalogPlanPrice): CatalogPlanPricePayload {
  return {
    code: price.code.trim(),
    billingInterval: price.billingInterval,
    billingIntervalCount: price.billingIntervalCount,
    currency: price.currency,
    amount: price.amount.trim(),
    status: price.status,
    providerPrices: price.providerPrices.map((providerPrice) => ({
      provider: providerPrice.provider,
      providerProductId: providerPrice.providerProductId?.trim() || null,
      providerPriceId: providerPrice.providerPriceId?.trim() || null,
      providerMetadata: providerPrice.providerMetadata ?? {},
      status: providerPrice.status,
    })),
  };
}

function commercialSnapshot(
  prices: CatalogPlanPricePayload[],
  entitlements: Array<EntitlementDraft | ParsedEntitlement>,
) {
  return {
    prices,
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

function blankProviderPrice(): ProviderPriceDraft {
  return {
    key: crypto.randomUUID(),
    provider: "paypal",
    providerProductId: "",
    providerPriceId: "",
    providerMetadata: {},
    status: "active",
  };
}

function blankPrice(): PriceDraft {
  return {
    key: crypto.randomUUID(),
    code: "",
    billingInterval: "month",
    billingIntervalCount: 1,
    currency: "MXN",
    amount: "",
    status: "active",
    providerPrices: [blankProviderPrice()],
  };
}

function updatePrice<K extends keyof PriceDraft>(
  index: number,
  key: K,
  value: PriceDraft[K],
  setPrices: (update: (items: PriceDraft[]) => PriceDraft[]) => void,
) {
  setPrices((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item));
}

function updateProviderPrice<K extends keyof ProviderPriceDraft>(
  priceIndex: number,
  providerIndex: number,
  key: K,
  value: ProviderPriceDraft[K],
  setPrices: (update: (items: PriceDraft[]) => PriceDraft[]) => void,
) {
  setPrices((items) => items.map((price, index) => index === priceIndex
    ? {
        ...price,
        providerPrices: price.providerPrices.map((providerPrice, currentIndex) =>
          currentIndex === providerIndex ? { ...providerPrice, [key]: value } : providerPrice),
      }
    : price));
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

const inputClassName = "bg-card font-normal";
const selectTriggerClassName = "w-full rounded-lg bg-card font-normal";
