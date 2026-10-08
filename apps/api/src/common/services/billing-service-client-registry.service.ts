import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BillingServiceClientEntity } from '../entities/billing-service-client.entity';
import { parseBillingServiceClients } from '../../config/billing-service-clients';

@Injectable()
export class BillingServiceClientRegistryService {
  constructor(
    @InjectRepository(BillingServiceClientEntity)
    private readonly clients: Repository<BillingServiceClientEntity>,
  ) {}

  async findPolicy(clientId: string, manager?: EntityManager) {
    const repository = manager
      ? manager.getRepository(BillingServiceClientEntity)
      : this.clients;
    const row = await repository.findOne({ where: { clientId } });
    // Invalid stored policies fail closed rather than falling back to environment grants.
    return row
      ? parseBillingServiceClients(JSON.stringify({ [clientId]: row.policy }))[
          clientId
        ]
      : undefined;
  }
}
