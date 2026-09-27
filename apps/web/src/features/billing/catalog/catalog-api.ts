import { apiFetch, toQueryString } from "@/lib/api";

export type CatalogTab = "products" | "plans" | "addons";
export type CatalogStatus = "active" | "inactive" | "archived";
export type BillingProvider = "paypal" | "stripe" | "mercado_pago" | "manual_transfer";
export type BillingCurrency = "MXN" | "USD";
export type BillingInterval = "monthly" | "yearly";
export type PlanPriceBillingInterval = "month" | "year";
export type PlanVersionStatus = "draft" | "published" | "archived";
export type PlanPriceStatus = "active" | "archived";
export type ProviderPriceStatus = "active" | "archived";
export type FeatureValueType = "boolean" | "integer" | "decimal" | "string" | "json";
export type FeatureAggregationStrategy = "replace" | "sum" | "max" | "min" | "boolean_or" | "boolean_and";
export type BillingAddonType = "recurring";
export type BillingAddonPricingModel = "flat" | "per_unit";
export type AddonEntitlementEffects = {
  numeric: Record<string, number>;
  features: Record<string, boolean>;
};

export type CatalogPage<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type CatalogProduct = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "inactive";
};

export type CatalogProductPayload = {
  code: string;
  name: string;
  description?: string | null;
  status?: CatalogProduct["status"];
};

export type CatalogPlan = {
  id: string;
  productId: string;
  productCode?: string;
  product?: CatalogProduct;
  code: string;
  name: string;
  description: string | null;
  status: "active" | "archived";
  versions: CatalogPlanVersion[];
};

export type CatalogProviderPrice = {
  id: string;
  provider: BillingProvider;
  providerProductId: string | null;
  providerPriceId: string | null;
  providerMetadata: Record<string, unknown>;
  status: ProviderPriceStatus;
};

export type CatalogPlanPrice = {
  id: string;
  code: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  currency: BillingCurrency;
  amount: string;
  status: PlanPriceStatus;
  providerPrices: CatalogProviderPrice[];
};

export type CatalogFeatureDefinition = {
  id: string;
  productId: string;
  code: string;
  name: string;
  description: string | null;
  valueType: FeatureValueType;
  unit: string | null;
  aggregationStrategy: FeatureAggregationStrategy;
  isMetered: boolean;
  status: "active" | "archived";
};

export type CatalogPlanEntitlement = {
  id: string;
  feature: CatalogFeatureDefinition;
  valueJson: unknown;
};

export type CatalogPlanVersion = {
  id: string;
  version: number;
  status: PlanVersionStatus;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
  prices: CatalogPlanPrice[];
  entitlements: CatalogPlanEntitlement[];
};

export type CatalogProviderPricePayload = {
  provider: BillingProvider;
  providerProductId?: string | null;
  providerPriceId?: string | null;
  providerMetadata?: Record<string, unknown>;
  status?: ProviderPriceStatus;
};

export type CatalogPlanPricePayload = {
  code: string;
  billingInterval: PlanPriceBillingInterval;
  billingIntervalCount: number;
  currency: BillingCurrency;
  amount: string;
  status?: PlanPriceStatus;
  providerPrices: CatalogProviderPricePayload[];
};

export type CatalogFeatureDefinitionPayload = {
  code: string;
  name: string;
  description?: string | null;
  valueType: FeatureValueType;
  unit?: string | null;
  aggregationStrategy?: FeatureAggregationStrategy;
  isMetered?: boolean;
};

export type CatalogPlanEntitlementPayload = {
  featureCode?: string;
  featureId?: string;
  valueJson: unknown;
};

export type CatalogPlanVersionPayload = {
  version: number;
  status?: PlanVersionStatus;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  prices: CatalogPlanPricePayload[];
  entitlements?: CatalogPlanEntitlementPayload[];
};

export type CatalogPlanPayload = {
  productId: string;
  code: string;
  name: string;
  description?: string | null;
  status?: CatalogPlan["status"];
  features?: CatalogFeatureDefinitionPayload[];
  version?: CatalogPlanVersionPayload;
};

export type CatalogAddon = {
  id: string;
  productId: string;
  productCode: string;
  code: string;
  name: string;
  description: string | null;
  unitPrice: string;
  currency: BillingCurrency;
  billingInterval: BillingInterval;
  type: BillingAddonType;
  pricingModel: BillingAddonPricingModel;
  minQuantity: number;
  maxQuantity: number | null;
  provider: BillingProvider;
  providerPlanId: string | null;
  entitlementEffects: AddonEntitlementEffects;
  status: CatalogStatus;
};

export type CatalogAddonPayload = {
  productId: string;
  code: string;
  name: string;
  description?: string | null;
  unitPrice: string;
  currency: BillingCurrency;
  billingInterval: BillingInterval;
  type: BillingAddonType;
  pricingModel: BillingAddonPricingModel;
  minQuantity?: number;
  maxQuantity?: number | null;
  provider: BillingProvider;
  providerPlanId?: string | null;
  entitlementEffects: AddonEntitlementEffects;
  status?: CatalogAddon["status"];
};

export type CatalogFilters = {
  q?: string;
  product_id?: string;
  status?: CatalogStatus;
  provider?: BillingProvider;
  currency?: BillingCurrency;
  billing_interval?: BillingInterval;
  page?: number;
  limit?: number;
};

export function listCatalogProducts(filters: CatalogFilters) {
  return apiFetch<CatalogPage<CatalogProduct>>(
    `/billing/console/catalog/products${toQueryString({
      q: filters.q,
      status: filters.status,
      page: filters.page,
      limit: filters.limit,
    })}`,
  );
}

export function getCatalogProduct(id: string) {
  return apiFetch<CatalogProduct>(`/billing/console/catalog/products/${id}`);
}

export function createCatalogProduct(payload: CatalogProductPayload) {
  return apiFetch<CatalogProduct>("/billing/console/catalog/products", {
    body: payload,
    method: "POST",
  });
}

export function updateCatalogProduct(id: string, payload: CatalogProductPayload) {
  return apiFetch<CatalogProduct>(`/billing/console/catalog/products/${id}`, {
    body: payload,
    method: "PATCH",
  });
}

export function listCatalogPlans(filters: CatalogFilters) {
  return apiFetch<CatalogPage<CatalogPlan>>(
    `/billing/console/catalog/plans${toQueryString(filters)}`,
  );
}

export function getCatalogPlan(id: string) {
  return apiFetch<CatalogPlan>(`/billing/console/catalog/plans/${id}`);
}

export function createCatalogPlan(payload: CatalogPlanPayload) {
  return apiFetch<CatalogPlan>("/billing/console/catalog/plans", {
    body: payload,
    method: "POST",
  });
}

export function updateCatalogPlan(id: string, payload: CatalogPlanPayload) {
  return apiFetch<CatalogPlan>(`/billing/console/catalog/plans/${id}`, {
    body: payload,
    method: "PATCH",
  });
}

export function listCatalogAddons(filters: CatalogFilters) {
  return apiFetch<CatalogPage<CatalogAddon>>(
    `/billing/console/catalog/addons${toQueryString(filters)}`,
  );
}

export function getCatalogAddon(id: string) {
  return apiFetch<CatalogAddon>(`/billing/console/catalog/addons/${id}`);
}

export function createCatalogAddon(payload: CatalogAddonPayload) {
  return apiFetch<CatalogAddon>("/billing/console/catalog/addons", {
    body: payload,
    method: "POST",
  });
}

export function updateCatalogAddon(id: string, payload: CatalogAddonPayload) {
  return apiFetch<CatalogAddon>(`/billing/console/catalog/addons/${id}`, {
    body: payload,
    method: "PATCH",
  });
}

export function primaryVersion(plan: CatalogPlan) {
  return (
    plan.versions.find((version) => version.status === "published") ??
    [...plan.versions].sort((a, b) => b.version - a.version)[0]
  );
}

export function primaryPrice(plan: CatalogPlan) {
  return primaryVersion(plan)?.prices.find((price) => price.status === "active");
}

export function primaryProviderPrice(plan: CatalogPlan) {
  return primaryPrice(plan)?.providerPrices.find((price) => price.status === "active");
}

export function publishCatalogVersion(id: string) {
  return apiFetch(`/billing/console/catalog/plan-versions/${id}/publish`, { method: "POST" });
}
