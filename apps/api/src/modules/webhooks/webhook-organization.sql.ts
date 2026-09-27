// Resolve only signed provider references against local business records.
// Never trust organization IDs or custom metadata in the webhook payload.
export function webhookOrganizationSql(alias: string): string {
  if (!/^[a-z_]+$/.test(alias)) throw new Error('Static SQL alias required');
  const resource = `${alias}.payload_json->'resource'`;
  const subscriptions = `ARRAY[${resource}->>'id', ${resource}->>'subscription_id', ${resource}->>'billing_agreement_id', ${resource}#>>'{supplementary_data,related_ids,subscription_id}']`;
  const captures = `ARRAY[${resource}->>'id', ${resource}->>'sale_id', ${resource}#>>'{supplementary_data,related_ids,sale_id}']`;
  const payments = `ARRAY[${resource}->>'parent_payment', ${resource}->>'parent_payment_id', ${resource}#>>'{supplementary_data,related_ids,payment_id}']`;
  return `(SELECT CASE WHEN count(DISTINCT owned.organization_id)=1 THEN min(owned.organization_id::text)::uuid ELSE NULL END FROM (
    SELECT s.organization_id FROM subscriptions s WHERE s.provider='paypal' AND s.provider_subscription_id=ANY(${subscriptions}) AND s.deleted_at IS NULL
    UNION ALL SELECT s.organization_id FROM subscription_addons a JOIN subscriptions s ON s.id=a.subscription_id WHERE a.provider='paypal' AND a.provider_subscription_id=ANY(${subscriptions}) AND a.deleted_at IS NULL AND s.deleted_at IS NULL
    UNION ALL SELECT p.organization_id FROM payments p WHERE p.provider='paypal' AND (p.provider_capture_id=ANY(${captures}) OR p.provider_payment_id=ANY(${payments}))
    UNION ALL SELECT s.organization_id FROM payments p JOIN subscriptions s ON s.id=p.subscription_id WHERE p.provider='paypal' AND (p.provider_capture_id=ANY(${captures}) OR p.provider_payment_id=ANY(${payments})) AND s.deleted_at IS NULL
  ) owned WHERE ${alias}.verification_status='verified' AND ${alias}.provider='paypal')`;
}
