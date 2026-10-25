import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BillingServiceClientEntity } from '../entities/billing-service-client.entity';
import { parseBillingServicePolicy } from '../types/billing-service-policy';

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
    return row ? parseBillingServicePolicy(row.policy) : undefined;
  }
}
