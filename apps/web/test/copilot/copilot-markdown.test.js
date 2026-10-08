import { test, expect } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MessageContent } from '../../src/features/billing/copilot/copilot-message-content';
import { extractStreamingMessage } from '../../src/features/billing/copilot/copilot-api';

test('renders Markdown tables, lists, emphasis, quotes and code from streamed JSON', () => {
  const content = '## Planes\n\n| Plan | Precio |\n| --- | ---: |\n| Pro | **99 MXN** |\n\n- Mensual\n- Anual\n\n1. Revisar\n2. Guardar\n\n> Datos de ejemplo\n\n```json\n{"plan":"pro"}\n```\n\n[Producto](/products/new)';
  const streamed = extractStreamingMessage(JSON.stringify({ message: content, plan: null }));
  const html = renderToStaticMarkup(createElement(MessageContent, { content: streamed }));
  for (const tag of ['<table', '<thead', '<tbody', '<th', '<td', '<strong', '<ul', '<ol', '<blockquote', '<pre', '<code', '<h2', '<a ']) expect(html).toContain(tag);
  expect(html).toContain('99 MXN');
  expect(html).not.toContain('| ---');
  expect(html).toContain('overflow-x-auto');
});

test('keeps incomplete streaming tables renderable and does not execute HTML', () => {
  const html = renderToStaticMarkup(createElement(MessageContent, { content: '| Plan | Precio |\n| --- | --- |\n| Pro |' }));
  expect(html).toContain('<table');
  const unsafe = renderToStaticMarkup(createElement(MessageContent, { content: '<script>alert(1)</script>\n\n[link](javascript:alert(1))' }));
  expect(unsafe).not.toContain('<script>');
  expect(unsafe).not.toContain('href="javascript:');
});
