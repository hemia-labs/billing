import { test, expect } from 'bun:test';
import { createFevex, defineAgent, InMemoryRunStore } from '@fevex/core';
import { copilotAgents, validateCopilotOutput } from '../../../../apps/api/src/modules/copilot/copilot-agents';

for (const [name, definition] of Object.entries(copilotAgents)) {
  test(`${name} streams through installed Fevex with its output schema`, async () => {
    const output = name === 'product-draft'
      ? { message: 'Propuesta', product: { name: 'Agenda', code: 'agenda', description: 'Reservas', status: 'active' } }
      : { message: 'Propuesta', plan: { name: 'Pro', code: 'pro', description: 'Equipo', prices: [{ code: 'pro_month', amount: '199.00', currency: 'MXN', billingInterval: 'month', billingIntervalCount: 1 }], features: [] } };
    const gateway = {
      async *stream(input) {
        expect(input.outputSchema.type).toBe('object');
        expect(input.reasoning).toBe('low');
        const text = JSON.stringify(output);
        yield { type: 'output.delta', delta: text.slice(0, 20) };
        yield { type: 'output.delta', delta: text.slice(20) };
        yield { type: 'completed', result: { output } };
      },
    };
    const agent = defineAgent({ name, instructions: definition.instructions, outputSchema: definition.outputSchema });
    const runtime = createFevex({ agents: [agent], models: { default: gateway } });
    const events = [];
    for await (const event of runtime.streamAgent(name, { input: 'Test local', reasoning: 'low' })) events.push(event);
    expect(events.filter(event => event.type === 'model.output.delta')).toHaveLength(2);
    expect(events.at(-1).type).toBe('run.completed');
    expect(validateCopilotOutput(name, events.at(-1).payload.output)).toEqual(output);
  });
}

test('native Fevex sessions retain messages and unapplied proposals across runs', async () => {
  const calls = [];
  const output = { message: 'Propuesta', product: { name: 'Agenda', code: 'agenda', description: 'Reservas', status: 'active' } };
  const gateway = {
    async *stream(input) {
      calls.push(structuredClone(input.messages));
      yield { type: 'output.delta', delta: JSON.stringify(output) };
      yield { type: 'completed', result: { output } };
    },
  };
  const agent = defineAgent({ name: 'product-draft', instructions: copilotAgents['product-draft'].instructions, outputSchema: copilotAgents['product-draft'].outputSchema });
  const runStore = new InMemoryRunStore();
  const runtime = createFevex({ agents: [agent], models: { default: gateway }, runStore });
  const now = new Date().toISOString();
  const sessionId = crypto.randomUUID();
  await runStore.saveSession({ id: sessionId, history: [], createdAt: now, updatedAt: now });
  for await (const event of runtime.streamAgent(agent.name, { sessionId, input: 'Crea Agenda para reservas' })) void event;
  for await (const event of runtime.streamAgent(agent.name, { sessionId, input: 'Cambia solo el nombre a Agenda Pro' })) void event;
  expect(calls).toHaveLength(2);
  expect(calls[1].some(message => message.role === 'user' && message.content.includes('Crea Agenda'))).toBe(true);
  expect(calls[1].some(message => message.role === 'assistant' && message.content.includes('agenda'))).toBe(true);
  expect(calls[1].at(-1).content).toContain('Agenda Pro');
  for await (const event of runtime.streamAgent(agent.name, { input: 'Otra conversación' })) void event;
  expect(JSON.stringify(calls[2])).not.toContain('Agenda Pro');
});

test('restoring native sessions keeps the first proposal after more than six exchanges', async () => {
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  let session = { id: sessionId, history: [], createdAt: now, updatedAt: now };
  let lastMessages;
  const output = { message: 'Propuesta', product: { name: 'Agenda original', code: 'agenda', description: 'Reservas', status: 'active' } };
  const gateway = { async *stream(input) {
    lastMessages = input.messages;
    yield { type: 'output.delta', delta: JSON.stringify(output) };
    yield { type: 'completed', result: { output } };
  } };
  const definition = copilotAgents['product-draft'];
  const agent = defineAgent({ name: 'product-draft', instructions: definition.instructions, outputSchema: definition.outputSchema });
  for (let index = 0; index < 10; index++) {
    const runStore = new InMemoryRunStore();
    await runStore.saveSession({ ...session, revision: undefined });
    const runtime = createFevex({ agents: [agent], models: { default: gateway }, runStore });
    for await (const event of runtime.streamAgent(agent.name, { sessionId, input: index === 0 ? 'Mi primer producto: Agenda original' : `Cambio ${index}` })) void event;
    session = await runStore.getSession(sessionId);
  }
  expect(session.history).toHaveLength(20);
  expect(lastMessages.some(message => message.role === 'user' && message.content.includes('Mi primer producto'))).toBe(true);
  expect(lastMessages.some(message => message.role === 'assistant' && message.content.includes('Agenda original'))).toBe(true);
});
