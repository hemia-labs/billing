import { AppDataSource } from '../../../data-source';
import {
  DEFAULT_BILLING_CURRENCY,
  BillingInterval,
} from '../../modules/billing-shared/constants';
import {
  AddonStatus,
  BillingAddonType,
  BillingPlanStatus,
  BillingProductStatus,
  BillingProvider,
} from '../../modules/billing-shared/enums';
import {
  BillingAddonEntity,
  BillingPlanEntity,
  BillingProductEntity,
} from '../../modules/billing-shared/entities';

const MEDSYNC_FEATURES = {
  web_chat: true,
  ai_agent: true,
  knowledge_sync: true,
  handoff: true,
};

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
    seatsIncluded: number;
    featuresJson: Record<string, unknown>;
  },
): Promise<void> {
  const repository = AppDataSource.getRepository(BillingPlanEntity);
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
  plan.provider = BillingProvider.Paypal;
  plan.providerPlanId = null;
  plan.name = input.name;
  plan.billingInterval = BillingInterval.Monthly;
  plan.currency = DEFAULT_BILLING_CURRENCY;
  plan.amount = input.amount;
  plan.seatsIncluded = input.seatsIncluded;
  plan.featuresJson = input.featuresJson;
  plan.status = BillingPlanStatus.Active;

  await repository.save(plan);
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
  addon.status = AddonStatus.Active;
  addon.metadata = {};

  await repository.save(addon);
}

async function seedBillingCatalog() {
  await AppDataSource.initialize();

  try {
    const product = await upsertProduct();

    await upsertPlan(product, {
      code: 'medsync_basic_monthly',
      name: 'Basico',
      amount: '499.00',
      seatsIncluded: 1,
      featuresJson: {
        ...MEDSYNC_FEATURES,
        max_agents: 1,
        max_conversations_monthly: 1000,
      },
    });

    await upsertPlan(product, {
      code: 'medsync_pro_monthly',
      name: 'Profesional',
      amount: '999.00',
      seatsIncluded: 5,
      featuresJson: {
        ...MEDSYNC_FEATURES,
        max_agents: 3,
        max_conversations_monthly: 5000,
      },
    });

    await upsertPlan(product, {
      code: 'medsync_clinic_monthly',
      name: 'Clinica',
      amount: '1299.00',
      seatsIncluded: 10,
      featuresJson: {
        ...MEDSYNC_FEATURES,
        max_agents: 5,
        max_conversations_monthly: 10000,
      },
    });

    await upsertAddon(product);
  } finally {
    await AppDataSource.destroy();
  }
}

seedBillingCatalog().catch((error) => {
  console.error(error);
  process.exit(1);
});
