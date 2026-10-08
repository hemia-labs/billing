import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingServiceClientEntity } from '../../common/entities/billing-service-client.entity';
import {
  BillingServiceClients,
  parseBillingServiceClients,
} from '../../config/billing-service-clients';
import { BillingProductEntity } from '../billing-shared/entities/billing-product.entity';
import { BillingAuditService } from '../audit/billing-audit.service';
import { SaveServiceClientDto } from './dtos/save-service-client.dto';

@Injectable()
export class BillingServiceClientsService {
  constructor(
    @InjectRepository(BillingServiceClientEntity)
    private readonly clients: Repository<BillingServiceClientEntity>,
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    private readonly config: ConfigService,
    private readonly audit: BillingAuditService,
  ) {}

  async list() {
    const merged = new Map(
      Object.entries(
        this.config.get<BillingServiceClients>('auth.serviceClients') ?? {},
      ).map(([clientId, policy]) => [
        clientId,
        { clientId, ...policy, source: 'environment' },
      ]),
    );
    for (const row of await this.clients.find({ order: { clientId: 'ASC' } })) {
      const policy = parseBillingServiceClients(
        JSON.stringify({ [row.clientId]: row.policy }),
      )[row.clientId];
      merged.set(row.clientId, {
        clientId: row.clientId,
        ...policy,
        source: 'database',
      });
    }
    return [...merged.values()].sort((a, b) =>
      a.clientId.localeCompare(b.clientId),
    );
  }

  async save(
    clientId: string,
    dto: SaveServiceClientDto,
    actorSubject: string,
  ) {
    if (
      !clientId ||
      clientId.trim() !== clientId ||
      clientId.length > 120 ||
      /\s/.test(clientId)
    )
      throw new BadRequestException(
        'El client_id debe tener entre 1 y 120 caracteres, sin espacios.',
      );
    let policy: BillingServiceClients[string];
    try {
      policy = parseBillingServiceClients(JSON.stringify({ [clientId]: dto }))[
        clientId
      ];
    } catch {
      throw new BadRequestException(
        'Política inválida. Revisa productos, UUID de organizaciones y orígenes HTTPS sin rutas ni comodines.',
      );
    }
    if (!policy.allowedReturnOrigins.length)
      throw new BadRequestException('Agrega al menos un origen de retorno.');
    if (
      this.config.get<string>('app.nodeEnv') === 'production' &&
      policy.allowedReturnOrigins.some(
        (origin) => !origin.startsWith('https://'),
      )
    )
      throw new BadRequestException(
        'Los orígenes deben usar HTTPS en producción.',
      );
    const codes = [...new Set(policy.products)];
    const products = await this.products.find({
      where: { code: In(codes) },
      select: { code: true },
    });
    if (codes.includes('*') || products.length !== codes.length)
      throw new BadRequestException(
        'Selecciona códigos de productos existentes; no se permiten comodines.',
      );
    policy.products = codes;
    policy.allowedReturnOrigins = [...new Set(policy.allowedReturnOrigins)];
    if (policy.organizationScope === 'organizations')
      policy.organizationIds = [
        ...new Set(policy.organizationIds.map((id) => id.toLowerCase())),
      ];
    await this.clients.manager.transaction(async (manager) => {
      const repository = manager.getRepository(BillingServiceClientEntity);
      const previous = await repository.findOne({ where: { clientId } });
      const legacy =
        this.config.get<BillingServiceClients>('auth.serviceClients') ?? {};
      if (dto.allowSharedCheckouts === undefined)
        policy.allowSharedCheckouts =
          previous?.policy.allowSharedCheckouts ??
          (Object.hasOwn(legacy, clientId)
            ? legacy[clientId].allowSharedCheckouts
            : false);
      await repository.upsert({ clientId, policy }, ['clientId']);
      const row = await repository.findOneByOrFail({ clientId });
      await this.audit.record({
        manager,
        action: 'billing.integration.client.saved',
        resourceType: 'billing_service_clients',
        resourceId: row.id,
        metadata: {
          actorSubject,
          previousStatus: previous?.policy.enabled,
          newStatus: policy.enabled,
        },
      });
    });
    return { clientId, ...policy, source: 'database' };
  }
}
