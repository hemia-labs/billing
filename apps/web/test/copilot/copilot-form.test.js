import { test, expect } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProductForm } from '../../src/features/billing/catalog/product-form';
import { PlanForm } from '../../src/features/billing/catalog/plan-form';
import { CopilotLauncher } from '../../src/features/billing/copilot/copilot-launcher';
import { CopilotLauncherContext } from '../../src/features/billing/copilot/copilot-draft-context';

const launcher = html => html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)?.find(button => button.includes('Crear con MIA')) ?? '';

test('form launcher uses a non-submit button and reflects existing content', () => {
  let opened = false;
  const props = { onSubmit: async () => {}, submitLabel: 'Guardar', renderAssistAction: state => createElement(CopilotLauncherContext.Provider, { value: () => { opened = true; } }, createElement(CopilotLauncher, state)) };
  const empty = renderToStaticMarkup(createElement(ProductForm, props));
  expect(launcher(empty)).toContain('type="button"');
  const populated = renderToStaticMarkup(createElement(ProductForm, { ...props, initialProduct: { name: 'Agenda', code: 'agenda', description: '', status: 'active' } }));
  expect(populated).toContain('Mejorar con MIA');
  expect(opened).toBe(false);
});

test('plan launcher requires a product and is hidden for read-only forms', () => {
  const props = { products: [], submitLabel: 'Guardar', onSubmit: async () => {}, renderAssistAction: ({ productId, ...state }) => createElement(CopilotLauncher, { ...state, requiresProduct: !productId }) };
  const empty = renderToStaticMarkup(createElement(PlanForm, props));
  expect(empty).toContain('Selecciona un producto para usar MIA.');
  expect(launcher(empty)).toContain('disabled=""');
  const selected = renderToStaticMarkup(createElement(PlanForm, { ...props, defaultProductId: 'product-1' }));
  expect(selected).toContain('Crear con MIA');
  expect(launcher(selected)).not.toContain('disabled=""');
  expect(selected).not.toContain('Selecciona un producto para usar MIA.');
  const readOnly = renderToStaticMarkup(createElement(PlanForm, { ...props, readOnly: true }));
  expect(readOnly).not.toContain('Crear con MIA');
});

test('catalog forms work without the optional assistant', () => {
  for (const form of [ProductForm, PlanForm]) {
    const html = renderToStaticMarkup(createElement(form, { products: [], onSubmit: async () => {}, submitLabel: 'Guardar' }));
    expect(html).toContain('Guardar');
    expect(html).not.toContain('MIA');
  }
});
