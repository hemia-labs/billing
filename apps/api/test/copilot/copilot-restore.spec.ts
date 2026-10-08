import { BillingCopilotService } from '../../src/modules/copilot/billing-copilot.service';
import { CopilotSessionsService } from '../../src/modules/copilot/copilot-sessions.service';
import { BillingCatalogService } from '../../src/modules/catalog/billing-catalog.service';

describe('Copilot conversation recovery', () => {
  const input = {
    sessionId: '09135fe8-b7de-4d74-a910-1ce41df55618',
    agentId: 'product-draft',
  };
  const principal = {
    sub: 'user-a',
    organizationId: 'org-a',
    scopes: [],
    isMachine: false,
  };
  const product = {
    name: 'Agenda',
    code: 'agenda',
    description: 'Reservas',
    status: 'active',
  };
  it('restores display messages and proposals without returning the raw form context', async () => {
    const read = jest.fn().mockResolvedValue({
      history: [
        {
          role: 'user',
          content: JSON.stringify({
            instruction: 'Crea Agenda',
            currentProduct: { description: 'private form context' },
          }),
        },
        {
          role: 'assistant',
          content: JSON.stringify({ message: 'Propuesta', product }),
        },
      ],
    });
    const service = new BillingCopilotService(
      {} as BillingCatalogService,
      { read } as unknown as CopilotSessionsService,
    );
    const restored = await service.readSession(input, principal);
    expect(read).toHaveBeenCalledWith(
      ['user-a', 'org-a', 'product-draft', 'new'],
      input.sessionId,
    );
    expect(restored.messages[0].content).toBe('Crea Agenda');
    expect(restored.messages[1]).toMatchObject({
      content: 'Propuesta',
      product,
      status: 'completed',
    });
    expect(JSON.stringify(restored)).not.toContain('private form context');
    await expect(service.readSession(input)).rejects.toThrow();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('returns not found for expired or differently scoped sessions', async () => {
    const read = jest.fn().mockResolvedValue(null);
    const service = new BillingCopilotService(
      {} as BillingCatalogService,
      { read } as unknown as CopilotSessionsService,
    );
    await expect(
      service.readSession(input, { ...principal, sub: 'user-b' }),
    ).rejects.toThrow('expiró');
    expect(read).toHaveBeenCalledWith(
      ['user-b', 'org-a', 'product-draft', 'new'],
      input.sessionId,
    );
  });
});
