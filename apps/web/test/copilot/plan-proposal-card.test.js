import { test, expect } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PlanProposalCard } from '../../src/features/billing/copilot/plan-proposal-card';

test('displays money, billing period and feature values without changing their meaning', () => {
  const plan = { name: 'Pro', code: 'pro', description: 'Para equipos', prices: [{ code: 'quarterly', amount: '1299.50', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 3 }], features: [{ code: 'support', name: 'Soporte', valueType: 'boolean', value: ' true ', unit: '' }, { code: 'users', name: 'Usuarios', valueType: 'integer', value: '10', unit: 'usuarios' }] };
  const html = renderToStaticMarkup(createElement(PlanProposalCard, { plan, action: createElement('button', null, 'Usar propuesta') }));
  for (const text of ['1,299.50', 'MXN', 'cada 3 meses', 'Incluido', '10 usuarios', 'Sin guardar', 'Usar propuesta']) expect(html).toContain(text);
  expect(html.match(/Usar propuesta/g)).toHaveLength(1);
});
