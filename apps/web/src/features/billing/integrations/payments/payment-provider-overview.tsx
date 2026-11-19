import Link from "next/link";
import { CreditCard, Settings2 } from "lucide-react";
import { Badge } from "@/components/zuno/badge";
import { Button } from "@/components/zuno/button";
import { Card, CardContent, CardFooter } from "@/components/zuno/card";
import { paymentIntegrationHref } from "./payment-products";

export function PaymentProviderOverview({ canManage }: { canManage: boolean }) {
  return (
      <section aria-label="Proveedores disponibles" className="grid items-stretch gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card aria-labelledby="payment-provider-paypal" className="flex min-w-0 flex-col overflow-hidden rounded-lg shadow-sm" role="article">
          <CardContent className="flex-1 p-5">
            <span className="grid size-12 place-items-center rounded-lg border border-border bg-secondary text-primary">
              <CreditCard aria-hidden="true" className="size-6" />
            </span>
            <h2 className="mt-4 text-base font-semibold" id="payment-provider-paypal">PayPal</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">Cobra suscripciones con tu app de PayPal.</p>
          </CardContent>
          <CardFooter className="min-h-16 flex-wrap justify-between gap-3 border-t border-border px-5 py-3">
            <Button aria-label={canManage ? "Configurar PayPal" : "Consultar PayPal"} render={<Link href={paymentIntegrationHref()} />} variant="outline">
              <Settings2 aria-hidden="true" className="size-4" />{canManage ? "Configurar" : "Consultar"}
            </Button>
            <Badge variant="outline">Suscripciones</Badge>
          </CardFooter>
        </Card>
      </section>
  );
}
