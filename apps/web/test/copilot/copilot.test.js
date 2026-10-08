import { test, expect } from 'bun:test';
import { copilotRoute, conversationKey, planForAgent } from '../../src/features/billing/copilot/copilot-types';
import { extractStreamingMessage, streamCopilot } from '../../src/features/billing/copilot/copilot-api';

test('routes tasks and isolates conversations by task and product', () => {
  expect(copilotRoute('/products/new', null, null).agentId).toBe('product-draft');
  expect(copilotRoute('/products/a', null, 'plans')).toEqual({ agentId: 'plan-draft', productId: 'a' });
  expect(copilotRoute('/products/a', null, 'addons').agentId).toBeNull();
  expect(copilotRoute('/products/plans/new', 'a', null).productId).toBe('a');
  expect(copilotRoute('/products/plans/existing', null, null).agentId).toBeNull();
  expect(conversationKey('plan-draft', 'a')).not.toBe(conversationKey('plan-draft', 'b'));
  expect(conversationKey('product-draft', null)).not.toBe(conversationKey('plan-draft', null));
});

test('plan context excludes provider mappings and internal fields', () => {
  const draft = { name: 'Pro', code: 'pro', description: '', prices: [{ code: 'monthly', amount: '99.00', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 1, status: 'active', providerPrices: [{ providerPriceId: 'private-price-id' }] }], features: [] };
  const result = planForAgent(draft);
  expect(result.prices[0]).toEqual({ code: 'monthly', amount: '99.00', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 1 });
  expect(JSON.stringify(result)).not.toContain('private-price-id');
  expect(draft.prices[0].providerPrices).toHaveLength(1);
  expect(copilotRoute('/products/plans/new', '09135fe8-b7de-4d74-a910-1ce41df55618', null)).toEqual({ agentId: 'plan-draft', productId: '09135fe8-b7de-4d74-a910-1ce41df55618' });
});

test('streams the plan agent with its product and editable proposal', async () => {
  const originalFetch = globalThis.fetch;
  const productId = '09135fe8-b7de-4d74-a910-1ce41df55618';
  const plan = { name: 'Pro', code: 'pro', description: '', prices: [{ code: 'monthly', amount: '99.00', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 1 }], features: [] };
  globalThis.fetch = async (_url, options) => {
    expect(JSON.parse(options.body)).toMatchObject({ agentId: 'plan-draft', productId, currentPlan: plan });
    return new Response(`event: run.completed\ndata: ${JSON.stringify({ type: 'run.completed', payload: { output: { message: 'Propuesta', plan } } })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  try {
    const events = [];
    await streamCopilot({ agentId: 'plan-draft', productId, currentPlan: plan, instruction: 'Mejora la descripción', modelId: 'test', effort: 'low' }, new AbortController().signal, event => events.push(event));
    expect(events[0].payload.output.plan).toEqual(plan);
  } finally { globalThis.fetch = originalFetch; }
});

test('shows partial messages safely across JSON escapes', () => {
  expect(extractStreamingMessage('{"message":"Hola')).toBe('Hola');
  expect(extractStreamingMessage('{"message":"Línea\\nuno\\')).toBe('Línea\nuno');
  expect(extractStreamingMessage('{"message":"\\u00')).toBe('');
  expect(extractStreamingMessage('{"message":"\\u00e1')).toBe('á');
});

test('delivers a fragmented SSE delta before completion and cancels the reader', async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let controller;
  let cancelled = false;
  let firstDelta;
  const received = new Promise(resolve => { firstDelta = resolve; });
  const stream = new ReadableStream({ start(value) { controller = value; }, cancel() { cancelled = true; } });
  const sessionId = '09135fe8-b7de-4d74-a910-1ce41df55618';
  globalThis.fetch = async (_url, options) => {
    expect(JSON.parse(options.body)).toMatchObject({ sessionId, continueSession: true, agentId: 'product-draft' });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
  };
  const seen = [];
  try {
    const run = streamCopilot({ agentId: 'product-draft', instruction: 'Hola', sessionId, continueSession: true, modelId: 'test', effort: 'low' }, new AbortController().signal, event => { seen.push(event.type); firstDelta(); });
    controller.enqueue(encoder.encode(': keepalive\r\n\r\nevent: model.output.delta\r\ndata: {"type":"model.output.delta","payload":{"delta":"hola"}}\r'));
    controller.enqueue(encoder.encode('\n\r\n'));
    await received;
    expect(seen).toEqual(['model.output.delta']);
    controller.enqueue(encoder.encode('event: run.completed\ndata: {"type":"run.completed","payload":{"output":{}}}\n\n'));
    await run;
    expect(seen).toEqual(['model.output.delta', 'run.completed']);
    expect(cancelled).toBe(true);
  } finally { globalThis.fetch = originalFetch; }
});
