import { once } from 'node:events';
import {
  Body,
  Controller,
  Get,
  Query,
  Header,
  Delete,
  HttpCode,
  Logger,
  Post,
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../../common/types/authenticated-request.type';
import { ZodError } from 'zod';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { BillingConsoleAuthGuard } from '../../common/guards/billing-console-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { BillingCopilotService } from './billing-copilot.service';
import { CopilotRateLimitGuard } from './copilot-rate-limit.guard';

@Controller('billing/console/copilot')
@UseGuards(BillingConsoleAuthGuard, PermissionsGuard)
@Permissions('billing.catalog.manage')
export class BillingCopilotController {
  private readonly logger = new Logger(BillingCopilotController.name);
  constructor(private readonly copilot: BillingCopilotService) {}

  @Get('models')
  models() {
    return this.copilot.listModels();
  }

  @Get('agents')
  agents() {
    return this.copilot.listAgents();
  }

  @Get('sessions')
  @Header('Cache-Control', 'no-store')
  readSession(@Query() input: unknown, @Req() request: AuthenticatedRequest) {
    return this.copilot.readSession(input, request.principal);
  }

  @Delete('sessions')
  @HttpCode(204)
  async deleteSession(
    @Body() input: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    await this.copilot.deleteSession(input, request.principal);
  }

  @Post('runs/stream')
  @UseGuards(CopilotRateLimitGuard)
  async stream(
    @Body() input: unknown,
    @Res() response: Response,
    @Req() request: AuthenticatedRequest,
  ): Promise<void> {
    const prepared = await this.copilot.prepareRun(input, request.principal);
    if (response.destroyed) return;
    const abort = new AbortController();
    let timedOut = false;
    let terminalSent = false;
    const onClose = () => abort.abort();
    response.on('close', onClose);
    const timeout = setTimeout(() => {
      timedOut = true;
      abort.abort();
    }, 120_000);
    const heartbeat = setInterval(() => {
      if (
        !response.destroyed &&
        !response.writableEnded &&
        !response.writableNeedDrain
      )
        response.write(': keepalive\n\n');
    }, 15_000);
    const write = async (type: string, payload: unknown = {}) => {
      if (response.destroyed || response.writableEnded) return;
      const ready = response.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, payload })}\n\n`,
      );
      if (!ready && !abort.signal.aborted)
        await once(response, 'drain', { signal: abort.signal });
    };
    const fail = async (code: string) => {
      terminalSent = true;
      this.logger.warn(`Copilot ${prepared.input.agentId} failed (${code})`);
      await write('run.failed', {
        code,
        message:
          code === 'TIMEOUT'
            ? 'El agente tardó demasiado. Inténtalo de nuevo.'
            : code === 'SESSION_EXPIRED'
              ? 'Esta conversación expiró. Inicia una nueva conversación para continuar.'
              : code === 'CONTEXT_FULL'
                ? 'Esta conversación alcanzó su límite de contexto. Inicia una nueva conversación.'
                : code === 'INVALID_OUTPUT'
                  ? 'La propuesta no es válida. Ajusta la solicitud e inténtalo de nuevo.'
                  : 'No se pudo completar la tarea. Inténtalo de nuevo.',
      });
    };

    try {
      response.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      });
      response.flushHeaders();
      for await (const event of this.copilot.streamRun(
        prepared,
        abort.signal,
      )) {
        if (abort.signal.aborted) break;
        if (event.type === 'run.failed') {
          await fail('AGENT_FAILED');
          break;
        }
        if (event.type === 'run.completed') {
          terminalSent = true;
          await write(event.type, { output: event.payload.output });
          break;
        }
        if (event.type === 'run.cancelled') {
          terminalSent = true;
          await write(event.type);
          break;
        }
        if (event.type === 'model.output.delta')
          await write(event.type, { delta: event.payload.delta });
        else if (
          event.type === 'run.started' ||
          event.type === 'model.started' ||
          event.type === 'model.completed'
        )
          await write(event.type);
      }
      if (!terminalSent && !response.destroyed)
        await fail(timedOut ? 'TIMEOUT' : 'INCOMPLETE_STREAM');
    } catch (error) {
      if (!terminalSent && !response.destroyed)
        await fail(
          timedOut
            ? 'TIMEOUT'
            : error instanceof Error &&
                ['SESSION_EXPIRED', 'CONTEXT_FULL'].includes(error.message)
              ? error.message
              : error instanceof ZodError
                ? 'INVALID_OUTPUT'
                : 'AGENT_FAILED',
        );
    } finally {
      clearTimeout(timeout);
      clearInterval(heartbeat);
      abort.abort();
      response.off('close', onClose);
      if (!response.destroyed && !response.writableEnded) response.end();
    }
  }
}
