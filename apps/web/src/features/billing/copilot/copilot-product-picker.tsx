"use client";

import { useEffect, useState } from 'react';
import { getCatalogProduct, listCatalogProducts, type CatalogProduct } from '../catalog/catalog-api';
import { ApiError, apiErrorMessage, redirectToLogin } from '@/lib/api';
import { Input } from '@/components/zuno/input';
import { Button } from '@/components/zuno/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/zuno/select';

export function CopilotProductPicker({ productId, onChange, disabled }: { productId: string | null; onChange: (id: string | null) => void; disabled: boolean }) {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ key: string; items: CatalogProduct[]; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = productId ?? `search:${query}`;
  const current = result?.key === key ? result : null;

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void (productId ? getCatalogProduct(productId).then(product => [product]) : listCatalogProducts({ q: query, limit: 100 }).then(page => page.items))
        .then(items => { if (active) setResult({ key, items }); })
        .catch(error => {
          if (!active) return;
          if (error instanceof ApiError && error.status === 401) redirectToLogin();
          setResult({ key, items: [], error: apiErrorMessage(error, 'No se pudieron cargar los productos.') });
        });
    }, productId ? 0 : 250);
    return () => { active = false; clearTimeout(timer); };
  }, [productId, query, key, retry]);

  if (current?.error) return <div role="alert" className="text-xs text-destructive">{current.error}<Button onClick={() => { setResult(null); setRetry(value => value + 1); }} type="button" variant="ghost" size="sm">Reintentar</Button></div>;
  if (productId) return <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">Producto: {current?.items[0]?.name ?? 'Cargando…'}</span><Button disabled={disabled} onClick={() => onChange(null)} type="button" variant="ghost" size="sm">Cambiar</Button></div>;
  return (
    <div className="space-y-2">
      <Input aria-label="Buscar producto para el plan" disabled={disabled} placeholder="Buscar producto…" value={query} onChange={event => setQuery(event.target.value)} />
      <Select value={null} disabled={disabled || !current?.items.length} onValueChange={value => { if (value) onChange(value); }}>
        <SelectTrigger className="w-full" aria-label="Producto del plan"><SelectValue placeholder={!current ? 'Cargando productos…' : current.items.length ? 'Selecciona un producto' : 'Sin resultados'} /></SelectTrigger>
        <SelectContent>{current?.items.map(product => <SelectItem value={product.id} key={product.id}>{product.name}</SelectItem>)}</SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Selecciona el producto al que pertenecerá el plan.</p>
    </div>
  );
}
