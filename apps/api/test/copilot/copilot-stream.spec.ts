import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../src/common/types/authenticated-request.type';
const request = {
  principal: { sub: 'user-1', organizationId: 'org-1' },
} as AuthenticatedRequest;
import { BillingCopilotController } from '../../src/modules/copilot/billing-copilot.controller';
import { BillingCopilotService } from '../../src/modules/copilot/billing-copilot.service';

describe('BillingCopilotController streaming', () => {
  const input = {
    agentId: 'product-draft',
    instruction: 'Reservas',
    modelId: 'openai:test',
    effort: 'low',
  };
  function response() {
    return Object.assign(new EventEmitter(), {
      status: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      flushHeaders: jest.fn(),
      write: jest.fn<boolean, [string]>().mockReturnValue(true),
      end: jest.fn(),
      destroyed: false,
      writableEnded: false,
      writableNeedDrain: false,
    });
  }
  function controller(streamRun: unknown) {
    return new BillingCopilotController({
      prepareRun: jest.fn().mockResolvedValue({ input }),
      streamRun,
    } as unknown as BillingCopilotService);
  }

  it('writes deltas before completion and waits for backpressure', async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    let advanced = false;
    const res = response();
    res.write.mockReturnValueOnce(false);
    const run = controller(async function* () {
      yield { type: 'model.output.delta', payload: { delta: 'Hola' } };
      advanced = true;
      await gate;
      yield {
        type: 'run.completed',
        payload: { output: { message: 'Hola', product: null } },
      };
    }).stream(input, res as unknown as Response, request);
    await new Promise(setImmediate);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(advanced).toBe(false);
    expect(res.end).not.toHaveBeenCalled();
    res.emit('drain');
    await new Promise(setImmediate);
    expect(advanced).toBe(true);
    finish();
    await run;
    expect(res.write.mock.calls[1][0]).toContain('run.completed');
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(res.listenerCount('close')).toBe(0);
  });

  it('redacts provider failures and emits only one terminal event', async () => {
    const res = response();
    await controller(async function* () {
      await Promise.resolve();
      yield { type: 'run.started', payload: { input: 'private context' } };
      yield {
        type: 'run.failed',
        payload: { error: 'private provider detail' },
      };
      throw new Error('must not iterate after failure');
    }).stream(input, res as unknown as Response, request);
    const output = res.write.mock.calls.map((call) => call[0]).join('');
    expect(output).not.toContain('private');
    expect(output.match(/event: run.failed/g)).toHaveLength(1);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('reports streams that close without a terminal event', async () => {
    const res = response();
    await controller(async function* () {
      await Promise.resolve();
      yield { type: 'model.started', payload: {} };
    }).stream(input, res as unknown as Response, request);
    expect(res.write.mock.calls.at(-1)?.[0]).toContain('INCOMPLETE_STREAM');
  });

  it('aborts the provider on disconnect and cleans listeners', async () => {
    const res = response();
    let receivedSignal: AbortSignal | undefined;
    const run = controller(async function* (_: unknown, signal: AbortSignal) {
      receivedSignal = signal;
      yield { type: 'model.started', payload: {} };
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    }).stream(input, res as unknown as Response, request);
    await new Promise(setImmediate);
    res.destroyed = true;
    res.emit('close');
    await run;
    expect(receivedSignal?.aborted).toBe(true);
    expect(res.write).toHaveBeenCalledTimes(1);
    expect(res.listenerCount('close')).toBe(0);
  });
});
