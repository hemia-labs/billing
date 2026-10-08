import type { ExecutionContext } from '@nestjs/common';
import type Redis from 'ioredis';
import { CopilotRateLimitGuard } from '../../src/modules/copilot/copilot-rate-limit.guard';

describe('Copilot request budget', () => {
  it('limits the authenticated actor through shared Redis and fails closed', async () => {
    const evaluate = jest.fn().mockResolvedValue(1);
    const setHeader = jest.fn();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          principal: { sub: 'user-a', organizationId: 'org-a' },
        }),
        getResponse: () => ({ setHeader }),
      }),
    } as unknown as ExecutionContext;
    const guard = new CopilotRateLimitGuard({
      eval: evaluate,
    } as unknown as Redis);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    evaluate.mockResolvedValue(11);
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 429,
    });
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '60');
    evaluate.mockRejectedValue(new Error('redis offline'));
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 503,
    });
  });
});
