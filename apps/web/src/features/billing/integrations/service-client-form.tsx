"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/zuno/button";
import { Input } from "@/components/zuno/input";
import { Switch } from "@/components/zuno/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/zuno/select";
import { listCatalogProducts, type CatalogProduct } from "../catalog/catalog-api";
import { ApiError, apiErrorMessage, redirectToLogin } from "@/lib/api";
import {
  listIdentityOAuthClients,
  saveServiceClient,
  mergeReturnOrigins,
  mergeOrganizationIds,
  validateOrganizationIds,
  validateReturnOrigins,
  splitEntries,
  validateServiceClient,
  type IdentityOAuthClient,
  type ServiceClient,
  type ServiceClientPayload,
} from "./service-clients-api";

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 429)
    return "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
  return apiErrorMessage(
    error,
    "No se pudo guardar la autorización. Intenta de nuevo.",
  );
}

export function ServiceClientForm({
  client,
  existingIds,
  onBusyChange,
  onCancel,
  onSaved,
}: {
  client: ServiceClient | null;
  existingIds: string[];
  onBusyChange?: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: (client: ServiceClient) => void;
}) {
  const [clientId, setClientId] = useState(client?.clientId ?? "");
  const productsTriggerRef = useRef<HTMLDivElement>(null);
  const [products, setProducts] = useState<string[]>(client?.products ?? []);
  const [billingProducts, setBillingProducts] = useState<CatalogProduct[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [productsRevision, setProductsRevision] = useState(0);
  const [scope, setScope] = useState<ServiceClient["organizationScope"]>(
    client?.organizationScope ?? "all_for_allowed_products",
  );
  const [organizations, setOrganizations] = useState<string[]>(client?.organizationIds ?? []);
  const [organizationDraft, setOrganizationDraft] = useState("");
  const [origins, setOrigins] = useState<string[]>(client?.allowedReturnOrigins ?? []);
  const [originDraft, setOriginDraft] = useState("");
  const [enabled, setEnabled] = useState(client?.enabled ?? true);
  const [identityClients, setIdentityClients] = useState<IdentityOAuthClient[]>([]);
  const [loadingIdentityClients, setLoadingIdentityClients] = useState(!client);
  const [identityClientsError, setIdentityClientsError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    async function loadProducts() {
      try {
        const items: CatalogProduct[] = [];
        let page = 1;
        let total = 0;
        do {
          const result = await listCatalogProducts({ page, limit: 100 }, controller.signal);
          if (controller.signal.aborted) return;
          items.push(...result.items);
          total = result.total;
          if (!result.items.length) break;
          page += 1;
        } while (items.length < total);
        setBillingProducts(items);
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setProductsError(error instanceof ApiError && error.status === 429
          ? "Demasiadas solicitudes. Espera un momento e intenta de nuevo."
          : apiErrorMessage(error, "No se pudieron cargar los productos de Billing."));
      } finally {
        if (!controller.signal.aborted) setLoadingProducts(false);
      }
    }
    void loadProducts();
    return () => controller.abort();
  }, [productsRevision]);
  useEffect(() => {
    if (client) return;
    const controller = new AbortController();
    listIdentityOAuthClients(controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setIdentityClients(items);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && error.status === 401) {
          redirectToLogin();
          return;
        }
        setIdentityClientsError(
          error instanceof ApiError && error.status === 403
            ? "No tienes permiso para consultar el catálogo de Identity. Puedes escribir el client_id manualmente."
            : error instanceof ApiError && error.status === 503
              ? "Identity no respondió al catálogo. Confirma el secreto de Billing y el destino identity-api con el scope identity.oauth_clients.read. Puedes escribir el client_id manualmente."
              : "No se pudo consultar el catálogo de Identity. Puedes escribir el client_id manualmente.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingIdentityClients(false);
      });
    return () => controller.abort();
  }, [client]);
  function addOrigins(draft = originDraft) {
    if (!draft.trim() || saving) return;
    const next = mergeReturnOrigins(origins, draft);
    const message = validateReturnOrigins(next);
    setErrors((current) => ({ ...current, allowedReturnOrigins: message ?? "" }));
    if (message) setOriginDraft(draft);
    if (!message) {
      setOrigins(next);
      setOriginDraft("");
    }
  }
  function addOrganizations(draft = organizationDraft) {
    if (!draft.trim() || saving) return;
    const next = mergeOrganizationIds(organizations, draft);
    const message = validateOrganizationIds(next);
    setErrors((current) => ({ ...current, organizationIds: message ?? "" }));
    if (message) setOrganizationDraft(draft);
    else {
      setOrganizations(next);
      setOrganizationDraft("");
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const id = clientId.trim();
    const payload: ServiceClientPayload = {
      enabled,
      products: [...new Set(products)],
      organizationScope: scope,
      ...(scope === "organizations"
        ? {
            organizationIds: mergeOrganizationIds(organizations, organizationDraft),
          }
        : {}),
      allowedReturnOrigins: mergeReturnOrigins(origins, originDraft),
      allowSharedCheckouts: client?.allowSharedCheckouts ?? false,
    };
    const nextErrors = validateServiceClient(id, payload);
    if (!client && existingIds.includes(id))
      nextErrors.clientId =
        "Este cliente ya está registrado. Edita su autorización en la lista.";
    setErrors(nextErrors);
    setError("");
    if (Object.keys(nextErrors).length) {
      event.currentTarget
        .querySelector<HTMLElement>(`#consumer-${Object.keys(nextErrors)[0]}`)
        ?.focus();
      return;
    }
    if (payload.organizationIds) {
      setOrganizations(payload.organizationIds);
      setOrganizationDraft("");
    }
    setOrigins(payload.allowedReturnOrigins);
    setOriginDraft("");
    setSaving(true);
    onBusyChange?.(true);
    try {
      onSaved(await saveServiceClient(id, payload));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        redirectToLogin();
        return;
      }
      setError(errorMessage(error));
    } finally {
      setSaving(false);
      onBusyChange?.(false);
    }
  }
  const fieldError = (field: string) =>
    errors[field] && (
      <span id={`consumer-${field}-error`} className="text-xs text-destructive">
        {errors[field]}
      </span>
    );
  const describedBy = (field: string) =>
    errors[field] ? `consumer-${field}-error` : undefined;
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <div>
          <h2 className="text-base font-semibold">Identificación del cliente</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Selecciona el cliente OAuth que consumirá la API de Billing. Sus
            permisos OAuth se administran en Identity.
          </p>
        </div>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="consumer-clientId"
        >
          Cliente de Identity
          {client ? (
            <Input
              id="consumer-clientId"
              className="bg-background font-normal"
              autoFocus
              readOnly
              value={clientId}
              aria-invalid={!!errors.clientId}
              aria-describedby={describedBy("clientId")}
            />
          ) : identityClients.length > 0 || loadingIdentityClients ? (
            <Select
              value={clientId || null}
              disabled={loadingIdentityClients}
              onValueChange={(value) => setClientId(value ?? "")}
            >
              <SelectTrigger
                id="consumer-clientId"
                className="bg-background font-normal"
                autoFocus
                aria-label="Cliente de Identity"
                aria-invalid={!!errors.clientId}
                aria-describedby={
                  describedBy("clientId") ?? "consumer-clientId-help"
                }
              >
                <SelectValue
                  placeholder={
                    loadingIdentityClients
                      ? "Cargando opciones…"
                      : "Selecciona una opción"
                  }
                />
              </SelectTrigger>
              <SelectContent className="w-[var(--anchor-width)] max-w-[var(--anchor-width)] min-w-0">
                {identityClients.map((identityClient) => (
                  <SelectItem
                    key={identityClient.clientId}
                    value={identityClient.clientId}
                    className="w-full min-w-0 overflow-hidden"
                  >
                    <span className="flex min-w-0 max-w-full flex-col overflow-hidden">
                      <span className="max-w-full truncate">{identityClient.clientId}</span>
                      <span className="max-w-full truncate text-xs text-muted-foreground">
                        {identityClient.audience} · {identityClient.scopes.join(", ")}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              id="consumer-clientId"
              className="bg-background font-normal"
              autoFocus
              required
              maxLength={120}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder="Ingresa un valor"
              aria-invalid={!!errors.clientId}
              aria-describedby={
                describedBy("clientId") ?? "consumer-clientId-help"
              }
            />
          )}
          {!client && (
            <span
              id="consumer-clientId-help"
              className="text-xs font-normal text-muted-foreground"
              role={identityClientsError ? "status" : undefined}
              aria-live="polite"
            >
              {identityClientsError ||
                (loadingIdentityClients
                  ? "Consultando clientes de servicio en Identity…"
                  : identityClients.length
                    ? `${identityClients.length} clientes de servicio disponibles; también puedes escribir el ID.`
                    : "No hay clientes de servicio disponibles; escribe el ID de Identity.")}
            </span>
          )}
          {fieldError("clientId")}
        </label>
        <div className="border-t border-border pt-5">
          <h2 className="text-base font-semibold">Alcance de la autorización</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Define los productos y las organizaciones a los que tendrá acceso.
          </p>
        </div>
        <div className="grid gap-2 text-sm font-medium">
          <span id="consumer-products-label">Productos permitidos</span>
          <Select multiple value={products} onValueChange={setProducts} disabled={loadingProducts || !!productsError || saving}>
            <SelectTrigger
              id="consumer-products"
              render={<div ref={productsTriggerRef} />}
              nativeButton={false}
              className="h-auto min-h-10 bg-background font-normal"
              aria-labelledby="consumer-products-label"
              aria-invalid={!!errors.products}
              aria-describedby={describedBy("products") ?? "consumer-products-help"}
            >
              <SelectValue className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {() => products.length ? products.map((code) => {
                  const name = billingProducts.find((product) => product.code === code)?.name ?? code;
                  return (
                    <span key={code} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted pl-2 text-xs text-foreground">
                      <span className="min-w-0 truncate" title={code}>{name}</span>
                      <button
                        type="button"
                        className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
                        aria-label={`Quitar ${name}`}
                        disabled={loadingProducts || !!productsError || saving}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                        onKeyUp={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          setProducts((current) => current.filter((item) => item !== code));
                          productsTriggerRef.current?.focus();
                        }}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                      </button>
                    </span>
                  );
                }) : loadingProducts ? "Cargando productos…" : "Selecciona productos"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="w-[var(--anchor-width)] max-w-[var(--anchor-width)] min-w-0">
              {billingProducts.map((product) => (
                <SelectItem key={product.code} value={product.code} className="min-w-0">
                  <span className="flex min-w-0 flex-col">
                    <span className="break-words">{product.name}{product.status === "inactive" ? " · Inactivo" : ""}</span>
                    <span className="break-all text-xs text-muted-foreground">{product.code}</span>
                  </span>
                </SelectItem>
              ))}
              {products.filter((code) => !billingProducts.some((product) => product.code === code)).map((code) => (
                <SelectItem key={code} value={code}>{code} · Fuera del catálogo disponible</SelectItem>
              ))}
              {!billingProducts.length && !products.length && <p className="p-3 text-sm text-muted-foreground">No hay productos registrados en Billing.</p>}
            </SelectContent>
          </Select>
          <span id="consumer-products-help" className="text-xs font-normal text-muted-foreground" aria-live="polite">
            {loadingProducts ? "Consultando el catálogo de Billing…" : productsError || "Selecciona uno o varios productos del catálogo de Billing."}
          </span>
          {productsError && (
            <Button type="button" variant="outline" className="w-fit" onClick={() => { setLoadingProducts(true); setProductsError(""); setProductsRevision((value) => value + 1); }}>Reintentar</Button>
          )}
          {fieldError("products")}
        </div>
        <label
          className="grid gap-2 text-sm font-medium"
          htmlFor="consumer-scope"
        >
          Organizaciones permitidas
          <Select
            value={scope}
            onValueChange={(value) =>
              setScope(value as ServiceClient["organizationScope"])
            }
          >
              <SelectTrigger id="consumer-scope" className="w-full bg-background font-normal">
              <SelectValue>
                {(value: string | null) =>
                  value === "organizations"
                    ? "Organizaciones específicas"
                    : "Todas las de los productos permitidos"
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="organizations">
                Organizaciones específicas
              </SelectItem>
              <SelectItem value="all_for_allowed_products">
                Todas las de los productos permitidos
              </SelectItem>
            </SelectContent>
          </Select>
        </label>
        {scope === "organizations" && (
          <EntryListField
            id="consumer-organizationIds"
            label="UUID de organizaciones"
            placeholder="Agrega un UUID"
            help="Presiona Enter o Agregar. Puedes pegar varios UUID separados por comas, espacios o saltos de línea."
            values={organizations}
            draft={organizationDraft}
            onDraftChange={setOrganizationDraft}
            onAdd={addOrganizations}
            onRemove={(id) => setOrganizations((current) => current.filter((item) => item !== id))}
            disabled={saving}
            error={errors.organizationIds}
          />
        )}
        <div className="border-t border-border pt-5">
          <h2 className="text-base font-semibold">Retorno del checkout</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Autoriza los orígenes de las URLs de éxito y cancelación.
          </p>
        </div>
        <EntryListField
          id="consumer-allowedReturnOrigins"
          label="Orígenes de retorno permitidos"
          placeholder="https://app.tudominio.com"
          help="Presiona Enter o Agregar. Puedes pegar varios orígenes separados por comas, espacios o saltos de línea. Sin rutas ni comodines; el puerto debe coincidir."
          values={origins}
          draft={originDraft}
          onDraftChange={setOriginDraft}
          onAdd={addOrigins}
          onRemove={(origin) => setOrigins((current) => current.filter((item) => item !== origin))}
          disabled={saving}
          error={errors.allowedReturnOrigins}
        />
        <div className="border-t border-border pt-5">
          <h2 className="text-base font-semibold">Estado de la autorización</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            La política se aplica a las siguientes solicitudes del cliente.
          </p>
        </div>
        <label className="flex items-center gap-3 text-sm font-medium">
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Autorización habilitada"
          />
          Autorización habilitada
        </label>
      </fieldset>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t border-border pt-5">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onCancel}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Guardando…" : client ? "Guardar cambios" : "Registrar cliente"}
        </Button>
      </div>
    </form>
  );
}

function EntryListField({ id, label, placeholder, help, values, draft, onDraftChange, onAdd, onRemove, disabled, error }: {
  id: string;
  label: string;
  placeholder: string;
  help: string;
  values: string[];
  draft: string;
  onDraftChange: (value: string) => void;
  onAdd: (value: string) => void;
  onRemove: (value: string) => void;
  disabled: boolean;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  function add(value: string) {
    onAdd(value);
    inputRef.current?.focus();
  }
  return (
    <div className="grid gap-2 text-sm font-medium">
      <label htmlFor={id}>{label}</label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/50">
          {values.map((value) => (
            <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-md bg-muted pl-2 text-xs font-normal text-foreground">
              <span className="min-w-0 break-all">{value}</span>
              <button type="button" className="grid size-7 shrink-0 place-items-center rounded-md hover:bg-foreground/10 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50" aria-label={`Quitar ${value}`} disabled={disabled} onClick={() => { onRemove(value); inputRef.current?.focus(); }}>
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          ))}
          <input
            ref={inputRef}
            id={id}
            className="min-w-0 flex-1 basis-48 bg-transparent py-1 text-sm font-normal outline-none placeholder:text-muted-foreground"
            value={draft}
            disabled={disabled}
            onChange={(event) => onDraftChange(event.target.value)}
            onPaste={(event) => {
              const pasted = event.clipboardData.getData("text");
              if (splitEntries(pasted).length > 1) { event.preventDefault(); add(pasted); }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(draft); }
            }}
            placeholder={placeholder}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : `${id}-help`}
          />
        </div>
        <Button type="button" variant="outline" disabled={!draft.trim() || disabled} onClick={() => add(draft)}>Agregar</Button>
      </div>
      <span id={`${id}-help`} className="text-xs font-normal text-muted-foreground">{help}</span>
      {error && <span id={`${id}-error`} role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
