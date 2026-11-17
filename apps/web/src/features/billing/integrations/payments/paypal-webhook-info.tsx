import { Input } from "@/components/zuno/input";
import { apiBaseUrl } from "@/lib/api";

export function PaypalWebhookInfo({ path }: { path: string }) {
  return (
    <div className="space-y-2 border-t border-border pt-5">
      <label className="text-sm font-medium" htmlFor="paypal-webhook-url">URL del webhook</label>
      <Input aria-describedby="paypal-webhook-url-help" className="font-mono text-xs" id="paypal-webhook-url" readOnly value={new URL(path, apiBaseUrl).toString()} />
      <details className="text-xs text-muted-foreground" id="paypal-webhook-url-help"><summary className="cursor-pointer font-medium">Configurar el webhook</summary><p className="mt-2">Registra esta URL pública HTTPS en la misma app y entorno de PayPal. Añade su Webhook ID para habilitar nuevas contrataciones.</p></details>
    </div>
  );
}
