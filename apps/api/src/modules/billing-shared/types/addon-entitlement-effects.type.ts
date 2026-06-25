export type AddonEntitlementEffects = {
  numeric: Record<string, number>;
  features: Record<string, boolean>;
};

export const EMPTY_ADDON_ENTITLEMENT_EFFECTS: AddonEntitlementEffects = {
  numeric: {},
  features: {},
};
