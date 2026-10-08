import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/zuno/card';
import type { PlanDraft } from './copilot-types';

export function PlanProposalCard({ plan, action }: { plan: PlanDraft; action?: ReactNode }) {
  return (
    <Card aria-label="Plan propuesto" className="mt-4 min-w-0 overflow-hidden border-0 bg-muted/40 shadow-none">
      <CardHeader className="gap-3 p-4 pb-3">
        <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span>Plan propuesto</span>
          <span className="shrink-0 rounded-full bg-background/80 px-2 py-0.5">Sin guardar</span>
        </div>
        <div className="space-y-1">
          <CardTitle className="break-words leading-snug">{plan.name}</CardTitle>
          <p aria-label="Código del plan" className="break-all font-mono text-[11px] text-muted-foreground">{plan.code}</p>
        </div>
        {plan.description.trim() && <CardDescription className="whitespace-pre-wrap break-words text-xs leading-5">{plan.description}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4">
        <section aria-label="Precios propuestos" className="space-y-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">{plan.prices.length === 1 ? 'Precio' : 'Precios'}</h4>
          <ul className="divide-y divide-border/50 rounded-lg bg-background/70 px-3">
            {plan.prices.map(price => <li key={price.code} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-3">
              <div className="min-w-0">
                <span className="text-lg font-semibold tracking-tight tabular-nums">{new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(price.amount))}</span>
                <span className="ml-1.5 text-[11px] text-muted-foreground">{price.currency}</span>
                {plan.prices.length > 1 && <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{price.code}</p>}
              </div>
              <span className="text-xs text-muted-foreground">{price.billingIntervalCount === 1 ? price.billingInterval === 'month' ? 'al mes' : 'al año' : `cada ${price.billingIntervalCount} ${price.billingInterval === 'month' ? 'meses' : 'años'}`}</span>
            </li>)}
          </ul>
        </section>
        {plan.features.length > 0 ? <details className="group" open={plan.features.length <= 4}>
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs font-medium outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <span>Características <span className="ml-1 font-normal text-muted-foreground">{plan.features.length}</span></span>
            <ChevronDown aria-hidden="true" className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <dl className="mt-2 divide-y divide-border/40">
            {plan.features.map(feature => <div key={feature.code} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 text-xs">
              <dt className="min-w-0 break-words text-muted-foreground">{feature.name}</dt>
              <dd className="min-w-0 max-w-full whitespace-pre-wrap break-words font-medium">{feature.valueType === 'boolean' ? feature.value.trim() === 'true' ? 'Incluido' : 'No incluido' : `${feature.value}${feature.unit ? ` ${feature.unit}` : ''}`}</dd>
            </div>)}
          </dl>
        </details> : <p className="text-xs text-muted-foreground">Sin características definidas.</p>}
      </CardContent>
      {action && <CardFooter className="block border-t border-border/50 px-4 py-3">{action}</CardFooter>}
    </Card>
  );
}
