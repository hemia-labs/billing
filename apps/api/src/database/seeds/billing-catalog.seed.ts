import { AppDataSource } from '../../../data-source';
import {
  DEFAULT_BILLING_CURRENCY,
  BillingInterval,
} from '../../modules/billing-shared/constants';
import {
  AddonStatus,
  BillingAddonPricingModel,
  BillingAddonType,
  FeatureAggregationStrategy,
  FeatureDefinitionStatus,
  FeatureValueType,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
  PlanPriceBillingInterval,
  PlanPriceStatus,
  PlanVersionStatus,
  ProviderPriceStatus,
} from '../../modules/billing-shared/enums';
import {
  BillingAddonEntity,
  BillingFeatureDefinitionEntity,
  BillingPlanEntitlementEntity,
  BillingPlanEntity,
  BillingPlanPriceEntity,
  BillingPlanVersionEntity,
  BillingProductEntity,
  BillingProviderPriceEntity,
} from '../../modules/billing-shared/entities';

const PLAN_ENTITLEMENTS: Record<string, Record<string, unknown>> = {
  medsync_basic: {
    'professionals.included': 1,
    'users.auxiliary.included': 1,
    'businesses.included': 1,
    'branches.included': 1,
    'patients.unlimited_reasonable_use': true,
    'schedule.basic': true,
    'clinical_record.enabled': true,
    'clinical_history.enabled': true,
    'prescriptions.enabled': true,
    'documents.basic': true,
    'consents.basic': true,
    'clinic_settings.basic': true,
    'dashboard.basic': true,
    'support.standard': true,
  },
  medsync_pro: {
    'professionals.included': 1,
    'users.auxiliary.included': 3,
    'businesses.included': 1,
    'branches.included': 1,
    'patients.unlimited_reasonable_use': true,
    'schedule.advanced': true,
    'clinical_record.enabled': true,
    'clinical_history.enabled': true,
    'prescriptions.enabled': true,
    'documents.enabled': true,
    'consents.enabled': true,
    'clinical_templates.custom': true,
    'appointments.advanced_management': true,
    'dashboard.operational': true,
    'reports.basic': true,
    'support.priority': true,
    'onboarding.assisted': true,
  },
  medsync_clinic: {
    'professionals.included': 3,
    'users.auxiliary.included': 8,
    'branches.included': 1,
    'patients.unlimited_reasonable_use': true,
    'schedule.multi_professional': true,
    'clinical_record.enabled': true,
    'prescriptions.enabled': true,
    'documents.enabled': true,
    'consents.enabled': true,
    'clinical_templates.by_professional_or_specialty': true,
    'roles_permissions.advanced': true,
    'dashboard.admin': true,
    'reports.advanced_basic': true,
    'business_admin_audit.enabled': true,
    'support.priority': true,
    'onboarding.assisted': true,
  },
};

const ALLOWED_FEATURE_CODES = new Set(
  Object.values(PLAN_ENTITLEMENTS).flatMap((entitlements) =>
    Object.keys(entitlements),
  ),
);

const PAYPAL_PLAN_ID_ENV: Record<string, string> = {
  medsync_basic: 'PAYPAL_MEDSYNC_BASIC_PLAN_ID',
  medsync_pro: 'PAYPAL_MEDSYNC_PRO_PLAN_ID',
  medsync_clinic: 'PAYPAL_MEDSYNC_CLINIC_PLAN_ID',
};

const PAYPAL_EXTRA_USER_PLAN_ID_ENV = 'PAYPAL_MEDSYNC_EXTRA_USER_PLAN_ID';

function env(name: string): string | null {
  return process.env[name]?.trim() || null;
}

async function upsertProduct(): Promise<BillingProductEntity> {
  const repository = AppDataSource.getRepository(BillingProductEntity);
  const existing = await repository.findOne({ where: { code: 'medsync' } });
  const product =
    existing ??
    repository.create({
      code: 'medsync',
    });

  product.name = 'MedSync';
  product.description = 'Producto SaaS MedSync';
  product.status = BillingProductStatus.Active;

  return repository.save(product);
}

async function upsertPlan(
  product: BillingProductEntity,
  input: {
    code: string;
    name: string;
    amount: string;
  },
): Promise<void> {
  const repository = AppDataSource.getRepository(BillingPlanEntity);
  const versionRepository = AppDataSource.getRepository(
    BillingPlanVersionEntity,
  );
  const priceRepository = AppDataSource.getRepository(BillingPlanPriceEntity);
  const providerPriceRepository = AppDataSource.getRepository(
    BillingProviderPriceEntity,
  );
  const entitlementRepository = AppDataSource.getRepository(
    BillingPlanEntitlementEntity,
  );
  const existing = await repository.findOne({
    where: { productId: product.id, code: input.code },
  });
  const plan =
    existing ??
    repository.create({
      productId: product.id,
      product,
      code: input.code,
    });

  plan.productId = product.id;
  plan.product = product;
  plan.name = input.name;
  plan.description = null;
  plan.status = BillingPlanStatus.Active;

  const savedPlan = await repository.save(plan);
  const version =
    (await versionRepository.findOne({
      where: { planId: savedPlan.id, version: 1 },
    })) ??
    versionRepository.create({
      planId: savedPlan.id,
      plan: savedPlan,
      version: 1,
    });

  version.status = PlanVersionStatus.Published;
  version.effectiveFrom = null;
  version.effectiveUntil = null;
  const savedVersion = await versionRepository.save(version);

  const priceCode = `${input.code}_monthly_mxn`;
  const price =
    (await priceRepository.findOne({
      where: { planVersionId: savedVersion.id, code: priceCode },
    })) ??
    priceRepository.create({
      planVersionId: savedVersion.id,
      planVersion: savedVersion,
      code: priceCode,
    });

  price.billingInterval = PlanPriceBillingInterval.Month;
  price.billingIntervalCount = 1;
  price.currency = DEFAULT_BILLING_CURRENCY;
  price.amount = input.amount;
  price.status = PlanPriceStatus.Active;
  const savedPrice = await priceRepository.save(price);

  const providerPrice =
    (await providerPriceRepository.findOne({
      where: { planPriceId: savedPrice.id, provider: BillingProvider.Paypal },
    })) ??
    providerPriceRepository.create({
      planPriceId: savedPrice.id,
      planPrice: savedPrice,
      provider: BillingProvider.Paypal,
    });

  providerPrice.providerProductId = null;
  providerPrice.providerPriceId = env(PAYPAL_PLAN_ID_ENV[input.code]);
  providerPrice.providerMetadata = {};
  providerPrice.status = ProviderPriceStatus.Active;
  await providerPriceRepository.save(providerPrice);

  const entitlements = PLAN_ENTITLEMENTS[input.code];
  if (!entitlements) throw new Error(`Missing entitlements for ${input.code}`);

  for (const [code, valueJson] of Object.entries(entitlements)) {
    const feature = await upsertFeature(product, code, typeof valueJson);
    const entitlement =
      (await entitlementRepository.findOne({
        where: { planVersionId: savedVersion.id, featureId: feature.id },
      })) ??
      entitlementRepository.create({
        planVersionId: savedVersion.id,
        planVersion: savedVersion,
        featureId: feature.id,
        feature,
      });

    entitlement.valueJson = valueJson;
    await entitlementRepository.save(entitlement);
  }

  const obsoleteEntitlements = await entitlementRepository.find({
    where: { planVersionId: savedVersion.id },
    relations: { feature: true },
  });
  const planFeatureCodes = new Set(Object.keys(entitlements));
  await entitlementRepository.remove(
    obsoleteEntitlements.filter(
      (entitlement) => !planFeatureCodes.has(entitlement.feature.code),
    ),
  );
}

async function upsertFeature(
  product: BillingProductEntity,
  code: string,
  type: string,
): Promise<BillingFeatureDefinitionEntity> {
  const repository = AppDataSource.getRepository(
    BillingFeatureDefinitionEntity,
  );
  const feature =
    (await repository.findOne({ where: { productId: product.id, code } })) ??
    repository.create({ productId: product.id, product, code });

  feature.name = code;
  feature.description = null;
  feature.valueType =
    type === 'boolean' ? FeatureValueType.Boolean : FeatureValueType.Integer;
  feature.unit = featureUnit(code);
  feature.aggregationStrategy =
    type === 'boolean'
      ? FeatureAggregationStrategy.BooleanOr
      : FeatureAggregationStrategy.Sum;
  feature.isMetered = false;
  feature.status = FeatureDefinitionStatus.Active;

  return repository.save(feature);
}

function featureUnit(code: string): string | null {
  if (code.startsWith('professionals.')) return 'professionals';
  if (code.startsWith('users.')) return 'users';
  if (code.startsWith('businesses.')) return 'businesses';
  if (code.startsWith('branches.')) return 'branches';
  return null;
}

async function archiveObsoleteFeatures(
  product: BillingProductEntity,
): Promise<void> {
  const repository = AppDataSource.getRepository(
    BillingFeatureDefinitionEntity,
  );
  const features = await repository.find({
    where: { productId: product.id },
  });

  await Promise.all(
    features
      .filter((feature) => !ALLOWED_FEATURE_CODES.has(feature.code))
      .map((feature) =>
        repository.save({
          ...feature,
          status: FeatureDefinitionStatus.Archived,
        }),
      ),
  );
}

async function upsertAddon(product: BillingProductEntity): Promise<void> {
  const repository = AppDataSource.getRepository(BillingAddonEntity);
  const existing = await repository.findOne({
    where: { productCode: product.code, code: 'extra_user' },
  });
  const addon =
    existing ??
    repository.create({
      productId: product.id,
      product,
      productCode: product.code,
      code: 'extra_user',
    });

  addon.productId = product.id;
  addon.product = product;
  addon.productCode = product.code;
  addon.name = 'Usuario extra';
  addon.description = 'Usuario adicional para MedSync';
  addon.unitPrice = '99.00';
  addon.currency = DEFAULT_BILLING_CURRENCY;
  addon.billingInterval = BillingInterval.Monthly;
  addon.type = BillingAddonType.Recurring;
  addon.pricingModel = BillingAddonPricingModel.PerUnit;
  addon.minQuantity = 1;
  addon.maxQuantity = null;
  addon.provider = BillingProvider.Paypal;
  addon.providerPlanId = env(PAYPAL_EXTRA_USER_PLAN_ID_ENV);
  addon.entitlementEffects = {
    numeric: { max_users: 1 },
    features: {},
  };
  addon.status = AddonStatus.Active;
  addon.metadata = {};

  await repository.save(addon);
}

async function seedBillingCatalog() {
  await AppDataSource.initialize();

  try {
    const product = await upsertProduct();

    await upsertPlan(product, {
      code: 'medsync_basic',
      name: 'Basico',
      amount: '499.00',
    });

    await upsertPlan(product, {
      code: 'medsync_pro',
      name: 'Profesional',
      amount: '999.00',
    });

    await upsertPlan(product, {
      code: 'medsync_clinic',
      name: 'Clinica',
      amount: '1299.00',
    });

    await archiveObsoleteFeatures(product);
    await upsertAddon(product);
  } finally {
    await AppDataSource.destroy();
  }
}

seedBillingCatalog().catch((error) => {
  console.error(error);
  process.exit(1);
});
