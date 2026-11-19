const {createRequire}=require('node:module');
const apiRequire=createRequire(require('node:path').resolve(__dirname,'../../../../apps/api/package.json'));
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {DataSource}=apiRequire('typeorm');
const {BadGatewayException}=apiRequire('@nestjs/common');
const {resolve}=require('node:path');
const {BillingPaymentAttemptEntity}=require('../../../../apps/api/src/modules/payment-attempts/billing-payment-attempt.entity');
const {BillingPaymentAttemptsService}=require('../../../../apps/api/src/modules/payment-attempts/billing-payment-attempts.service');
const ds=new DataSource({type:'postgres',host:'127.0.0.1',port:Number(process.env.TEST_DATABASE_PORT),username:'postgres',password:'isolated-test-only',database:'billing_payment_attempts_test',entities:[BillingPaymentAttemptEntity],migrations:[resolve(__dirname,'../../../../apps/api/src/database/migrations/*.ts')],synchronize:false,migrationsRun:false});
async function run(){
 await ds.initialize();
 assert.equal((await ds.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema='public'"))[0].count,0);
 await ds.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
 await ds.runMigrations({transaction:'all'});
 const actor={issuer:'https://identity.test',clientId:'node-consumer'};
 const permissions=['billing.integration.checkout.create','billing.subscriptions.manage'];
 const input={idempotencyKey:randomUUID(),organizationId:randomUUID(),userId:randomUUID(),productCode:'node_product',planCode:'basic',planPriceCode:'basic-monthly',successUrl:'https://consumer.test/return',cancelUrl:'https://consumer.test/cancel'};
 await ds.query(`INSERT INTO billing_license_receivers(product_code,url,audience,resource,enabled)
  VALUES ($1,'https://consumer.test/webhook','consumer-api','https://consumer.test',true)`,[input.productCode]);
 const purchases=new Map(), selections=new Map();
 const originalSelection={providerConnectionId:randomUUID(),providerPriceMappingId:randomUUID()};
 let engineCalls=0,loseResponse=false,configuredProvider='paypal',resolutions=0,configuredSelection=originalSelection;
 const checkout={validateApprovalUrl:(_provider,value)=>value,resolveCheckoutProvider:async()=>{resolutions++;return configuredProvider;},
 resolveCheckoutSelection:async dto=>{
  assert(!selections.has(dto.idempotencyKey),'A reserved attempt must not resolve a new connection or price');
  selections.set(dto.idempotencyKey,configuredSelection);
  return configuredSelection;
 },createCheckoutSession:async (dto,_actor,pinnedSelection)=>{
  assert.equal(dto.provider,'paypal');
  assert.deepEqual(pinnedSelection,selections.get(dto.idempotencyKey));
  engineCalls++;await new Promise(resolve=>setTimeout(resolve,50));
  let result=purchases.get(dto.idempotencyKey);
  if(!result){result={checkoutId:randomUUID(),subscriptionId:randomUUID(),checkoutUrl:'https://www.paypal.com/approve',status:'created'};purchases.set(dto.idempotencyKey,result);}
  if(loseResponse){loseResponse=false;throw new BadGatewayException('lost provider response');}
  return result;
 },getCheckoutStatus:async checkoutId=>{
  const result=[...purchases.values()].find(value=>value.checkoutId===checkoutId);
  return {checkoutId,subscriptionId:result.subscriptionId,checkoutStatus:'approved',subscriptionStatus:'active',provider:'paypal'};
 }};
 const policy={assertContext:()=>Promise.resolve(),assertReturnUrls:()=>Promise.resolve()};
 const service=()=>new BillingPaymentAttemptsService(ds,checkout,{},policy);
 const parallel=await Promise.all(Array.from({length:12},()=>service().create(input,actor,permissions)));
 assert(parallel.some(value=>value.status==='ready'));assert.equal(engineCalls,1);assert.equal(purchases.size,1);
 assert.equal((await ds.query('SELECT count(*)::int AS count FROM payment_attempts'))[0].count,1);
 const [delivery]=await ds.query(`SELECT a.status,a.receipt->>'subscriptionId' AS subscription_id
  FROM billing_license_deliveries d JOIN payment_attempts a USING (organization_id,product_code)
  WHERE a.id=$1`,[input.idempotencyKey]);
 assert.deepEqual(delivery,{status:'ready',subscription_id:purchases.get(input.idempotencyKey).subscriptionId});
 assert.equal((await service().get(input.idempotencyKey,input,actor)).statusFresh,true);
 await assert.rejects(service().get(input.idempotencyKey,{...input,userId:randomUUID()},actor),error=>error.status===404);
 await assert.rejects(service().retry(input.idempotencyKey,input,{...actor,clientId:'other-client'},permissions),error=>error.status===404);
 await assert.rejects(service().create({...input,successUrl:'https://consumer.test/different'},actor,permissions),error=>error.status===409);
 assert.equal(engineCalls,1);
 const uncertain={...input,idempotencyKey:randomUUID()};loseResponse=true;
 assert.equal((await service().create(uncertain,actor,permissions)).status,'pending');
 assert.equal(purchases.size,2);
 configuredProvider='stripe';
 configuredSelection={providerConnectionId:randomUUID(),providerPriceMappingId:randomUUID()};
 const resolutionsBeforeRetry=resolutions;
 const receipt=await service().retry(uncertain.idempotencyKey,uncertain,actor,permissions);
 assert.equal(receipt.status,'ready');assert.equal(receipt.provider,'paypal');assert.equal(resolutions,resolutionsBeforeRetry);
 configuredProvider='paypal';configuredSelection=originalSelection;assert.equal(purchases.size,2);assert.equal(engineCalls,3);
 // Simulate a crashed worker's expired durable lease; a new instance resumes the same stored payload.
 const crashed={...input,idempotencyKey:randomUUID()};loseResponse=true;
 await service().create(crashed,actor,permissions);
 await ds.query("UPDATE payment_attempts SET lease_token=$2,lease_until=clock_timestamp()-interval '1 minute' WHERE id=$1",[crashed.idempotencyKey,randomUUID()]);
 await service().recoverPending();
 assert.equal((await service().get(crashed.idempotencyKey,crashed,actor)).status,'ready');assert.equal(purchases.size,3);
 console.log('PASS PostgreSQL central attempts: migrations, 12 concurrent creates/one purchase, ownership, receipt and license delivery, frozen URLs/provider/connection/price, lost-response replay, expired-lease recovery; no consumer database');
 await ds.destroy();
}
run().catch(async error=>{console.error(error);if(ds.isInitialized)await ds.destroy();process.exitCode=1;});
