import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BillingServiceClientEntity } from '../../../common/entities/billing-service-client.entity';
import {
  BillingServiceClientPolicy,
  parseBillingServicePolicy,
} from '../../../common/types/billing-service-policy';
import { BillingProductEntity } from '../../billing-shared/entities/billing-product.entity';
import { BillingAuditService } from '../../audit/billing-audit.service';
import { BillingIdentityOAuthClientsService } from '../oauth-clients/billing-identity-oauth-clients.service';
import { SaveServiceClientDto } from '../dtos/save-service-client.dto';

@Injectable()
export class BillingServiceClientsService {
  constructor(
    @InjectRepository(BillingServiceClientEntity)
    private readonly clients: Repository<BillingServiceClientEntity>,
    @InjectRepository(BillingProductEntity)
    private readonly products: Repository<BillingProductEntity>,
    private readonly config: ConfigService,
    private readonly audit: BillingAuditService,
    private readonly identity: BillingIdentityOAuthClientsService,
  ) {}

  async list() {
    return (await this.clients.find({ order: { clientId: 'ASC' } })).map(
      (row) => ({
        clientId: row.clientId,
        ...parseBillingServicePolicy(row.policy),
        source: 'database',
      }),
    );
  }

  async save(
    clientId: string,
    dto: SaveServiceClientDto,
    actorSubject: string,
    actorClientId?: string,
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
    let policy: BillingServiceClientPolicy;
    try {
      policy = parseBillingServicePolicy(dto);
    } catch {
      throw new BadRequestException(
        'Política inválida. Revisa productos, UUID de organizaciones y orígenes HTTPS sin rutas ni comodines.',
      );
    }
    const grants = policy.enabled
      ? await this.identity.billingScopes(clientId)
      : [];
    if (policy.enabled && grants.length === 0)
      throw new BadRequestException(
        'El cliente no tiene un destino y permisos vigentes para Billing.',
      );
    if (
      policy.enabled &&
      policy.organizationScope === 'organizations' &&
      policy.organizationIds.length === 0 &&
      grants.some((scope) =>
        [
          'billing.integration.checkout.create',
          'billing.integration.checkout.read',
          'billing.integration.licenses.read',
        ].includes(scope),
      )
    )
      throw new BadRequestException(
        'Selecciona organizaciones para las operaciones de cobros o licencias.',
      );
    if (
      policy.enabled &&
      grants.includes('billing.integration.checkout.create') &&
      !policy.allowedReturnOrigins.length
    )
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
      if (dto.allowSharedCheckouts === undefined)
        policy.allowSharedCheckouts =
          previous?.policy.allowSharedCheckouts ?? false;
      await repository.upsert({ clientId, policy }, ['clientId']);
      const row = await repository.findOneByOrFail({ clientId });
      await this.audit.record({
        manager,
        action: 'billing.integration.client.saved',
        resourceType: 'billing_service_clients',
        resourceId: row.id,
        metadata: {
          actorSubject,
          actorClientId,
          previousStatus: previous?.policy.enabled,
          newStatus: policy.enabled,
        },
      });
    });
    return { clientId, ...policy, source: 'database' };
  }
}
