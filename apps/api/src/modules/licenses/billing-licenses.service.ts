import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository, type EntityManager } from 'typeorm';
import { BillingEntitlementsService } from '../entitlements';
import { BillingLicenseEntity } from '../billing-shared';
import { LicenseStatus } from '../billing-shared';
import { BillingLicenseResolveResponseDto } from './dtos';
import { BillingLicenseMapper } from './mappers';

const ACCESSIBLE_LICENSE_STATUSES = [LicenseStatus.Active, LicenseStatus.Grace];

@Injectable()
export class BillingLicensesService {
  constructor(
    @InjectRepository(BillingLicenseEntity)
    private readonly licenses: Repository<BillingLicenseEntity>,
    private readonly entitlements: BillingEntitlementsService,
  ) {}

  async resolveLicense(
    organizationId: string,
    productCode: string,
    manager?: EntityManager,
  ): Promise<BillingLicenseResolveResponseDto> {
    const licenses =
      manager?.getRepository(BillingLicenseEntity) ?? this.licenses;
    const prioritizedLicense = await licenses.findOne({
      where: {
        organizationId,
        productCode,
        status: In(ACCESSIBLE_LICENSE_STATUSES),
      },
      relations: { subscription: true },
      order: { updatedAt: 'DESC' },
    });

    const fallbackLicense =
      prioritizedLicense ??
      (await licenses.findOne({
        where: { organizationId, productCode },
        relations: { subscription: true },
        order: { updatedAt: 'DESC' },
      }));

    const calculated = fallbackLicense?.subscriptionId
      ? await this.entitlements.resolveForSubscription(
          fallbackLicense.subscriptionId,
          manager,
        )
      : this.entitlements.emptyResolution();

    return BillingLicenseMapper.toResolveDto(
      fallbackLicense,
      productCode,
      new Date(),
      calculated,
    );
  }
}
