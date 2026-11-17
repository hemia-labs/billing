const {test,afterEach}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createPaymentsClient}=require('../dist');
const originalFetch=global.fetch;
afterEach(()=>{global.fetch=originalFetch;});
const organizationId=randomUUID();
const config={issuer:'https://identity-history.test',tokenUrl:'https://identity-history.test/oauth/token',clientId:'history',clientSecret:'synthetic',baseUrl:'https://billing-history.test/api/v1',audience:'billing-api',productCode:'medsync'};
const item=()=>({id:randomUUID(),subscriptionId:randomUUID(),organizationId,productCode:'medsync',provider:'paypal',amount:'499.00',currency:'MXN',status:'paid',paidAt:'2026-11-17T10:00:00.123Z',createdAt:'2026-11-17T10:00:00.123Z',reference:'CAPTURE',description:'Pago de suscripción'});
function mock(result){const calls=[];global.fetch=async(url,init)=>{calls.push({url:String(url),init});if(String(url)===config.tokenUrl)return Response.json({access_token:'synthetic',token_type:'Bearer',expires_in:600,scope:init.body.get('scope')});return typeof result==='function'?result(url,init):Response.json(result);};return calls;}

test('payment history is an org/product bound GET using the existing scope and preserves actual captured amounts',async()=>{
 const first=item(),second={...item(),amount:'125.50',paidAt:null,description:'Prorrateo por cambio de plan'},rows=[first,second];
 const calls=mock({items:rows,nextCursor:null}),client=createPaymentsClient(config);
 assert.deepEqual(await client.payments.list(organizationId.toUpperCase()),{items:rows,nextCursor:null});
 assert.equal(calls[0].init.body.get('scope'),'billing.subscriptions.manage');assert.equal(calls.length,2);
 const query=new URL(calls[1].url);assert.equal(query.pathname,'/api/v1/billing/payments');assert.equal(query.searchParams.get('organization_id'),organizationId);assert.equal(query.searchParams.get('product_code'),'medsync');
 assert.equal(calls[1].init.method,'GET');assert.equal(calls[1].init.body,undefined);
 assert.equal(calls[1].init.redirect,'error');assert.equal(calls[1].init.credentials,'omit');
});

test('history validates bounded cursor/options before I/O and keeps pagination opaque',async()=>{
 const rows=Array.from({length:25},item),cursor=Buffer.from('opaque history cursor').toString('base64url'),calls=mock({items:rows,nextCursor:cursor}),client=createPaymentsClient(config);
 assert.equal((await client.payments.list(organizationId,{cursor})).nextCursor,cursor);assert.equal(new URL(calls[1].url).searchParams.get('cursor'),cursor);
 const count=calls.length;
 for(const options of [null,[],{organizationId:randomUUID()},{productCode:'foreign'},{limit:100},{cursor:'!'},{cursor:'x'.repeat(2049)}])await assert.rejects(client.payments.list(organizationId,options),e=>e.code==='configuration'&&e.status===400);
 await assert.rejects(client.payments.list('bad'),e=>e.code==='configuration');assert.equal(calls.length,count);
});

test('history validates paid/refund evidence, dates, tenant, status, duplicates and strips private metadata',async()=>{
 const paid=item(),partial={...item(),amount:'9999999999.99',status:'partially_refunded',refundedAmount:'0.01'},refund={...item(),status:'refunded',refundedAmount:'499.00'},reversed={...item(),status:'reversed'};
 mock({items:[{...paid,metadata:{secret:'private'}},partial,refund,reversed],nextCursor:null});
 const page=await createPaymentsClient(config).payments.list(organizationId);assert.deepEqual(page.items,[paid,partial,refund,reversed]);
 for(const patch of [{organizationId:randomUUID()},{productCode:'foreign'},{provider:'other'},{status:'pending'},{status:'failed'},{amount:499},{amount:'1e2'},{amount:'-1.00'},{currency:'mxn'},{status:'partially_refunded'},{status:'partially_refunded',refundedAmount:'0.00'},{status:'partially_refunded',refundedAmount:'499.00'},{refundedAmount:'1.00'},{status:'refunded',refundedAmount:'500.00'},{paidAt:undefined},{createdAt:null},{reference:{url:'https://evil.test'}}]) {
  mock({items:[{...item(),...patch}],nextCursor:null});await assert.rejects(createPaymentsClient(config).payments.list(organizationId),e=>e.code==='contract');
 }
 for(const malformed of [{items:[paid,paid],nextCursor:null},{items:Array.from({length:26},item),nextCursor:null},{items:[],nextCursor:'!'},{items:[],nextCursor:'opaque'},{items:[],nextCursor:'x'.repeat(2049)}]) {
  mock(malformed);await assert.rejects(createPaymentsClient(config).payments.list(organizationId),e=>e.code==='contract');
 }
});

test('failed history reads never create, capture, confirm or retry a payment',async()=>{
 const calls=mock(()=>Response.json({message:'unavailable'},{status:503}));await assert.rejects(createPaymentsClient(config).payments.list(organizationId),e=>e.status===503);
 assert.equal(calls.length,2);assert.equal(calls[1].init.method,'GET');
});
