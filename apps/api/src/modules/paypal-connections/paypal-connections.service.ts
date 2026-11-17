import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import {
  BillingPaypalConnectionEntity,
  type PaypalConnectionEnvironment,
} from '../billing-shared/entities/billing-paypal-connection.entity';
import { PaypalConnectionCrypto } from './paypal-connection.crypto';
import {
  RotatePaypalConnectionDto,
  SavePaypalConnectionDto,
  ActivatePaypalConnectionDto,
  PaypalConnectionStatusDto,
} from './paypal-connection.dto';

export type PaypalConnectionCredentials = {
  id: string;
  productId: string;
  environment: PaypalConnectionEnvironment;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId: string;
  revision: string;
};

@Injectable()
export class PaypalConnectionsService {
  constructor(
    @InjectRepository(BillingPaypalConnectionEntity)
    private readonly connections: Repository<BillingPaypalConnectionEntity>,
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    private readonly crypto: PaypalConnectionCrypto,
    private readonly config: ConfigService,
  ) {}

  private metadata(
    connection: BillingPaypalConnectionEntity,
    webhookConnectionId = connection.id,
  ) {
    const prefix = this.config
      .get<string>('app.globalPrefix', 'api/v1')
      .replace(/^\/+|\/+$/g, '');
    return {
      id: connection.id,
      productId: connection.productId,
      name: connection.name,
      environment: connection.environment,
      clientId: connection.clientId,
      webhookId: connection.webhookId,
      enabled: connection.enabled,
      isDraft: connection.isDraft,
      isCurrent: connection.isCurrent,
      hasClientSecret: true,
      webhookPath: `/${prefix}/billing/webhooks/paypal/${webhookConnectionId}`,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
    };
  }

  private sameApp(
    left: BillingPaypalConnectionEntity,
    right: Pick<BillingPaypalConnectionEntity, 'clientId' | 'environment'>,
  ) {
    return (
      left.clientId === right.clientId && left.environment === right.environment
    );
  }

  private async state(
    repository: Repository<BillingPaypalConnectionEntity>,
    productId: string,
  ) {
    const current = await this.currentForProduct(productId, repository);
    const draft = await repository.findOneBy({ productId, isDraft: true });
    return {
      connection: current ? this.metadata(current) : null,
      draft: draft
        ? this.metadata(
            draft,
            current && this.sameApp(current, draft) ? current.id : draft.id,
          )
        : null,
      source: current ? ('product' as const) : ('global' as const),
      encryptionConfigured: this.crypto.configured(),
    };
  }

  private requireEncryption() {
    if (!this.crypto.configured())
      throw new ServiceUnavailableException(
        'PayPal connection encryption is not configured',
      );
  }

  private fresh(actual: Date, expected: string | undefined | null) {
    return (
      typeof expected === 'string' &&
      actual.getTime() === new Date(expected).getTime()
    );
  }

  private touch(connection: BillingPaypalConnectionEntity) {
    // A strictly increasing revision also detects rapid concurrent secret/status changes.
    connection.updatedAt = new Date(
      Math.max(Date.now(), connection.updatedAt.getTime() + 1),
    );
  }

  private secret(
    repository: Repository<BillingPaypalConnectionEntity>,
    id: string,
  ) {
    return repository
      .createQueryBuilder('connection')
      .addSelect('connection.clientSecretEncrypted')
      .where('connection.id = :id', { id })
      .getOne();
  }

  async get(productId: string) {
    if (!(await this.products.findOneBy({ id: productId })))
      throw new NotFoundException('Billing product not found');
    return this.state(this.connections, productId);
  }

  async save(productId: string, dto: SavePaypalConnectionDto) {
    this.requireEncryption();
    if (dto.clientSecret !== undefined && !dto.clientSecret.trim())
      throw new BadRequestException('PayPal client secret must not be empty');
    return this.connections.manager.transaction(async (manager) => {
      const product = await manager
        .getRepository(BillingProductEntity)
        .findOne({
          where: { id: productId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!product) throw new NotFoundException('Billing product not found');
      const repository = manager.getRepository(BillingPaypalConnectionEntity);
      const current = await this.currentForProduct(productId, repository);
      const existing = await repository.findOneBy({ productId, isDraft: true });
      if (
        existing
          ? dto.draftId !== existing.id ||
            !this.fresh(existing.updatedAt, dto.expectedUpdatedAt)
          : dto.draftId !== undefined || dto.expectedUpdatedAt !== undefined
      )
        throw new ConflictException(
          'PayPal draft changed; reload before saving',
        );
      const id = existing?.id ?? randomUUID();
      let secret = dto.clientSecret;
      if (secret === undefined) {
        const source =
          existing && this.sameApp(existing, dto)
            ? existing
            : current && this.sameApp(current, dto)
              ? current
              : null;
        if (!source)
          throw new BadRequestException(
            'Client secret is required for a new PayPal application or environment',
          );
        const encrypted = await this.secret(repository, source.id);
        if (!encrypted)
          throw new ConflictException('PayPal connection changed');
        secret = this.crypto.decrypt(
          encrypted.clientSecretEncrypted,
          encrypted.id,
        );
      }
      const draft = repository.create({
        ...(existing ?? {}),
        id,
        productId,
        name: dto.name,
        environment: dto.environment,
        clientId: dto.clientId,
        webhookId: dto.webhookId,
        enabled: false,
        isCurrent: false,
        isDraft: true,
        clientSecretEncrypted: this.crypto.encrypt(secret, id),
      });
      if (existing) this.touch(draft);
      await repository.save(draft);
      return this.state(repository, productId);
    });
  }

  async activate(
    productId: string,
    id: string,
    dto: ActivatePaypalConnectionDto,
  ) {
    this.requireEncryption();
    return this.connections.manager.transaction(async (manager) => {
      const product = await manager
        .getRepository(BillingProductEntity)
        .findOne({
          where: { id: productId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!product) throw new NotFoundException('Billing product not found');
      const repository = manager.getRepository(BillingPaypalConnectionEntity);
      const draft = await repository.findOneBy({ id, productId });
      if (!draft) throw new NotFoundException('PayPal draft not found');
      if (!draft.isDraft || !this.fresh(draft.updatedAt, dto.expectedUpdatedAt))
        throw new ConflictException(
          'PayPal draft changed; reload before activating',
        );
      const current = await this.currentForProduct(productId, repository);
      if (
        dto.expectedCurrentConnectionId !== (current?.id ?? null) ||
        (current
          ? !this.fresh(current.updatedAt, dto.expectedCurrentUpdatedAt)
          : dto.expectedCurrentUpdatedAt !== null)
      )
        throw new ConflictException(
          'Current PayPal connection changed; reload before activating',
        );
      if (!draft.webhookId.trim())
        throw new BadRequestException(
          'Webhook ID is required to activate a PayPal connection',
        );
      const encrypted = await this.secret(repository, draft.id);
      if (!encrypted) throw new ConflictException('PayPal draft changed');
      const secret = this.crypto.decrypt(
        encrypted.clientSecretEncrypted,
        draft.id,
      );
      if (!secret.trim())
        throw new BadRequestException('PayPal client secret must not be empty');
      if (current && this.sameApp(current, draft)) {
        Object.assign(current, {
          name: draft.name,
          webhookId: draft.webhookId,
          enabled: true,
          clientSecretEncrypted: this.crypto.encrypt(secret, current.id),
        });
        this.touch(current);
        await repository.save(current);
        // Drafts are never exposed to runtime or historical contracts.
        await repository.delete(draft.id);
      } else {
        if (current) {
          current.isCurrent = false;
          this.touch(current);
          await repository.save(current);
        }
        draft.isDraft = false;
        draft.isCurrent = true;
        draft.enabled = true;
        this.touch(draft);
        await repository.save(draft);
      }
      return this.state(repository, productId);
    });
  }

  async setStatus(
    productId: string,
    id: string,
    dto: PaypalConnectionStatusDto,
  ) {
    return this.connections.manager.transaction(async (manager) => {
      const product = await manager
        .getRepository(BillingProductEntity)
        .findOne({
          where: { id: productId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!product) throw new NotFoundException('Billing product not found');
      const repository = manager.getRepository(BillingPaypalConnectionEntity);
      const current = await repository.findOneBy({
        id,
        productId,
        isCurrent: true,
        isDraft: false,
      });
      if (!current)
        throw new NotFoundException('Current PayPal connection not found');
      if (dto.enabled) {
        this.requireEncryption();
        if (!current.webhookId.trim())
          throw new BadRequestException(
            'Webhook ID is required to enable a PayPal connection',
          );
        const encrypted = await this.secret(repository, id);
        if (
          !encrypted ||
          !this.crypto.decrypt(encrypted.clientSecretEncrypted, id).trim()
        )
          throw new ServiceUnavailableException(
            'PayPal connection credentials are unavailable',
          );
      }
      current.enabled = dto.enabled;
      this.touch(current);
      await repository.save(current);
      return this.state(repository, productId);
    });
  }

  async list(productId: string) {
    if (!(await this.products.findOneBy({ id: productId })))
      throw new NotFoundException('Billing product not found');
    const connections = await this.connections.find({
      where: { productId, isDraft: false },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return {
      connections: connections.map((connection) => this.metadata(connection)),
      encryptionConfigured: this.crypto.configured(),
    };
  }

  async rotate(productId: string, id: string, dto: RotatePaypalConnectionDto) {
    this.requireEncryption();
    if (!dto.clientSecret.trim())
      throw new BadRequestException('PayPal client secret must not be empty');
    return this.connections.manager.transaction(async (manager) => {
      const product = await manager
        .getRepository(BillingProductEntity)
        .findOne({
          where: { id: productId },
          lock: { mode: 'pessimistic_write' },
        });
      if (!product) throw new NotFoundException('Billing product not found');
      const repository = manager.getRepository(BillingPaypalConnectionEntity);
      const connection = await repository.findOneBy({
        id,
        productId,
        isDraft: false,
      });
      if (!connection)
        throw new NotFoundException('PayPal connection not found');
      if (
        connection.enabled &&
        dto.webhookId !== undefined &&
        !dto.webhookId.trim()
      )
        throw new BadRequestException(
          'Webhook ID is required for an enabled PayPal connection',
        );
      connection.clientSecretEncrypted = this.crypto.encrypt(
        dto.clientSecret,
        id,
      );
      if (dto.webhookId !== undefined) connection.webhookId = dto.webhookId;
      this.touch(connection);
      await repository.save(connection);
      return this.state(repository, productId);
    });
  }

  private async currentForProduct(
    productId: string,
    repository = this.connections,
  ) {
    const current = await repository.findOneBy({
      productId,
      isCurrent: true,
      isDraft: false,
    });
    if (!current && (await repository.existsBy({ productId, isDraft: false })))
      throw new ServiceUnavailableException(
        'PayPal product connection configuration is inconsistent',
      );
    return current;
  }

  async resolveForProduct(productCode: string): Promise<string | null> {
    const product = await this.products.findOne({
      where: { code: productCode },
    });
    if (!product) throw new NotFoundException('Billing product not found');
    const connection = await this.currentForProduct(product.id);
    if (!connection) return null;
    if (!connection.enabled)
      throw new ServiceUnavailableException(
        'PayPal connection is disabled for this product',
      );
    if (!connection.webhookId || !this.crypto.configured())
      throw new ServiceUnavailableException('PayPal connection is not ready');
    return connection.id;
  }

  async approvalConfiguration(id: string | null) {
    if (id === null) {
      return {
        clientId: this.config.get<string>('paypal.clientId') ?? '',
        environment:
          this.config.get<'sandbox' | 'live'>('paypal.environment') ??
          'sandbox',
      };
    }
    const connection = await this.connections.findOne({
      where: { id, isDraft: false },
      select: { clientId: true, environment: true },
    });
    if (!connection) return;
    return {
      clientId: connection.clientId,
      environment: connection.environment,
    };
  }

  async credentialsForConnection(
    id: string,
  ): Promise<PaypalConnectionCredentials> {
    const connection = await this.connections
      .createQueryBuilder('connection')
      .addSelect('connection.clientSecretEncrypted')
      .where('connection.id = :id AND connection.isDraft = false', { id })
      .getOne();
    if (!connection)
      throw new ServiceUnavailableException(
        'PayPal connection credentials are unavailable',
      );
    return {
      id: connection.id,
      productId: connection.productId,
      environment: connection.environment,
      baseUrl:
        connection.environment === 'live'
          ? 'https://api-m.paypal.com'
          : 'https://api-m.sandbox.paypal.com',
      clientId: connection.clientId,
      clientSecret: this.crypto.decrypt(
        connection.clientSecretEncrypted,
        connection.id,
      ),
      webhookId: connection.webhookId,
      revision: createHash('sha256')
        .update(connection.clientSecretEncrypted)
        .update('\0' + connection.webhookId)
        .digest('hex'),
    };
  }
  async listForRecovery(): Promise<
    Array<{ id: string | null; environment: PaypalConnectionEnvironment }>
  > {
    const connections = await this.connections.find({
      where: { isDraft: false },
      select: { id: true, environment: true },
      order: { createdAt: 'ASC' },
    });
    const global =
      this.config.get<string>('paypal.clientId') &&
      this.config.get<string>('paypal.clientSecret')
        ? [
            {
              id: null,
              environment: this.config.get<PaypalConnectionEnvironment>(
                'paypal.environment',
                'sandbox',
              ),
            },
          ]
        : [];
    return [
      ...global,
      ...connections.map(({ id, environment }) => ({ id, environment })),
    ];
  }
}
