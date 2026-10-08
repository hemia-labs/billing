import { Logger } from '@nestjs/common';
import { Client } from 'pg';
import type { ClientConfig } from 'pg';
import { DataSource } from 'typeorm';

type ListenerDatabaseOptions = {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: string;
  ssl?: ClientConfig['ssl'];
  extra?: { options?: unknown };
};

export class BillingQueueWakeup {
  private readonly logger = new Logger(BillingQueueWakeup.name);
  private listener?: Client;
  private connecting?: Promise<void>;
  private reconnectTimer?: NodeJS.Timeout;
  private retryTimer?: NodeJS.Timeout;
  private reconnectDelay = 1_000;
  private running?: Promise<void>;
  private requested = false;
  private stopping = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly channel: string,
    private readonly processPending: () => Promise<void>,
    private readonly nextAttemptSql: string,
  ) {}

  onApplicationBootstrap(): void {
    this.connectListener();
  }

  recover(): void {
    this.wake();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.connecting;
    const listener = this.listener;
    this.listener = undefined;
    await listener?.end().catch(() => undefined);
    await this.running;
  }

  private connectListener(): void {
    if (this.stopping || this.listener || this.connecting) return;
    this.connecting = this.openListener().finally(() => {
      this.connecting = undefined;
    });
  }

  private async openListener(): Promise<void> {
    const options = this.dataSource
      .options as unknown as ListenerDatabaseOptions;
    const clientConfig: ClientConfig = {
      host: options.host,
      port: options.port,
      user: options.username,
      password: options.password,
      database: options.database,
      ssl: options.ssl,
      connectionTimeoutMillis: 10_000,
      options:
        typeof options.extra?.options === 'string'
          ? options.extra.options
          : undefined,
    };
    const client = new Client(clientConfig);
    this.listener = client;
    client.on('notification', (message) => {
      if (message.channel === this.channel) this.wake();
    });
    client.on('error', () => this.listenerDisconnected(client));
    client.on('end', () => this.listenerDisconnected(client));

    try {
      await client.connect();
      if (this.stopping) {
        await client.end();
        return;
      }
      await client.query(`LISTEN ${this.channel}`);
      this.reconnectDelay = 1_000;
      this.logger.log({ event: 'billing_queue_listener_ready' });
      this.wake();
    } catch {
      this.listenerDisconnected(client);
      await client.end().catch(() => undefined);
    }
  }

  private listenerDisconnected(client: Client): void {
    if (this.listener !== client) return;
    this.listener = undefined;
    if (this.stopping) return;
    this.logger.warn({ event: 'billing_queue_listener_disconnected' });
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connectListener();
    }, delay);
    this.reconnectTimer.unref();
  }

  private wake(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.requested = true;
    if (this.running || this.stopping) return;
    this.running = this.drain()
      .catch(() => {
        this.logger.error({ event: 'billing_queue_cycle_failed' });
      })
      .finally(() => {
        this.running = undefined;
        if (this.requested && !this.stopping) this.wake();
      });
  }

  private async drain(): Promise<void> {
    do {
      this.requested = false;
      await this.processPending();
    } while (this.requested && !this.stopping);
    await this.scheduleNextAttempt();
  }

  private async scheduleNextAttempt(): Promise<void> {
    const [next] = await this.dataSource.query<
      Array<{ delay_ms: number | null }>
    >(this.nextAttemptSql);
    if (this.stopping || next?.delay_ms == null) return;
    this.retryTimer = setTimeout(
      () => this.wake(),
      Math.max(100, Math.min(Number(next.delay_ms), 2_147_483_647)),
    );
    this.retryTimer.unref();
  }
}
