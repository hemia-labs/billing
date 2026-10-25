const assert = require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createServer}=require('node:http');
const {createRequire}=require('node:module');
const apiRequire=createRequire(require('node:path').resolve(__dirname,'../../../../apps/api/package.json'));
const {ConfigService}=apiRequire('@nestjs/config');
const {LicenseWebhookDeliveryService}=require('../../../../apps/api/src/modules/licenses/license-webhook-delivery.service');

module.exports=async function checkLicenseConnections(ds) {
  const org=randomUUID(), suffix=randomUUID();
  const products=[`connection-a-${suffix}`,`connection-b-${suffix}`];
  const received=[],tokens=[];
  let changed=false;
  const server=createServer((req,res)=>{
    let body='';req.on('data',c=>body+=String(c));req.on('end',()=>{ void (async()=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/token') {
        tokens.push(Object.fromEntries(new URLSearchParams(body)));
        res.end(JSON.stringify({access_token:'header.payload.signature',token_type:'Bearer',scope:'billing.webhooks.deliver',expires_in:120}));return;
      }
      assert.equal(req.headers.authorization,'Bearer header.payload.signature');
      const payload=JSON.parse(body);received.push(payload);
      if(!changed) {changed=true;await ds.query('SELECT queue_billing_license($1,$2)',[org,payload.productCode]);}
      res.end(JSON.stringify({received:true}));
    })().catch(e=>{res.statusCode=500;res.end(JSON.stringify({error:String(e)}));});});
  });
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const [index,code] of products.entries()) {
      const [product]=await ds.query('INSERT INTO products(code,name) VALUES($1,$1) RETURNING id',[code]);
      await ds.query('INSERT INTO billing_license_receivers(product_code,url,resource,audience,enabled) VALUES($1,$2,$3,$4,true)',[code,base+'/license',base,`consumer-${index}`]);
      await ds.query("INSERT INTO licenses(organization_id,product_id,product_code,plan_code) VALUES($1,$2,$3,'basic')",[org,product.id,code]);
    }
    const initial=await ds.query('SELECT product_code,revision FROM billing_license_deliveries WHERE organization_id=$1 ORDER BY product_code',[org]);
    assert.equal(initial.length,2);
    const service=new LicenseWebhookDeliveryService(ds,new ConfigService({app:{nodeEnv:'test'},hemiaLegal:{tokenUrl:base+'/token',clientId:'fixture-billing',clientSecret:'fixture-only'}}),{current:async(organizationId,productCode)=>({organizationId,productCode,revision:String((await ds.query("SELECT nextval('billing_license_revision_seq') AS revision"))[0].revision),confirmedAt:new Date().toISOString(),license:{active:true},subscription:null})});
    await service.deliver();
    assert.equal(received.length,3,'concurrent change must deliver again');
    assert.deepEqual([...new Set(received.map(p=>p.productCode))].sort(),products.sort());
    assert.equal(tokens.length,2,'one cached token per receiver destination');
    assert(tokens.every(t=>t.resource===base));
    const done=await ds.query('SELECT lease_token,lease_until,attempts,delivered_at,next_attempt_at>clock_timestamp() AS scheduled FROM billing_license_deliveries WHERE organization_id=$1',[org]);
    assert(done.every(row=>row.lease_token===null && row.lease_until===null && row.attempts===0 && row.delivered_at && row.scheduled));
    await ds.query('UPDATE billing_license_receivers SET enabled=false WHERE product_code=$1',[products[0]]);
    const before=(await ds.query('SELECT revision FROM billing_license_deliveries WHERE organization_id=$1 AND product_code=$2',[org,products[0]]))[0].revision;
    await ds.query("UPDATE licenses SET plan_code='changed' WHERE organization_id=$1 AND product_code=$2",[org,products[0]]);
    assert.equal((await ds.query('SELECT revision FROM billing_license_deliveries WHERE organization_id=$1 AND product_code=$2',[org,products[0]]))[0].revision,before);
    assert.equal((await ds.query("SELECT to_regclass('public.balanz_webhook_deliveries') AS retired"))[0].retired,null);
    console.log('PASS generic license migration, two products per organization, SQL triggers, HTTP delivery, concurrent revisions, per-destination OAuth cache and disabled receiver');
  } finally { server.closeAllConnections();await new Promise(resolve=>server.close(resolve)); }
};
