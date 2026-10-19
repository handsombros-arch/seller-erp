import {createAdminClient} from '@/lib/supabase/server';
import {buildCoupangAuth,type CoupangCredentials} from './auth';
import {relayFetch} from '@/lib/api-relay';
type Raw=Record<string,any>;
export function validateDay(value:unknown,now=Date.now()):string|null{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return null;
  const at=Date.parse(value+'T00:00:00Z'),today=Date.parse(new Date(now).toISOString().slice(0,10)+'T00:00:00Z');
  if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==value||at>=today||at<today-7*86400000)return null;
  return value;
}
async function boundedJson(response:Response){if(!response.body)throw Error('RESPONSE_INVALID');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>262144)throw Error('RESPONSE_LIMIT');chunks.push(next.value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return JSON.parse(new TextDecoder().decode(bytes));
  }finally{try{await reader.cancel();}catch{}}
}
export async function collectOrdersReadOnly(day:string,deps:{verified:boolean;deadline:number;load:()=>Promise<CoupangCredentials|null>;sign:typeof buildCoupangAuth;request:typeof relayFetch;now?:()=>number}){
  const now=deps.now??Date.now,started=now();const next=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const result:Raw={checked_utc:new Date().toISOString(),day_utc:day,next_day_utc:next,relay_endpoint_verified:deps.verified,relay_host:'15.165.83.123',egress_ip_independently_observed:false,
    max_pages_per_endpoint:1,max_orders_per_response:50,requests:0,automatic_retries:0,db_write_attempts:0,inventory_changes:0,probes:[]};
  const finish=(state:string,error_code:string)=>({...result,state,error_code,checked_utc:new Date().toISOString(),elapsed_ms:Math.max(0,now()-started)});
  if(!deps.verified)return finish('BLOCKED','RELAY_CONFIG_REQUIRED');
  let cred;try{cred=await deps.load();}catch{return finish('BLOCKED','CREDENTIALS_UNAVAILABLE');}
  if(!cred||!/^\w+$/.test(cred.vendorId))return finish('BLOCKED','CREDENTIALS_UNAVAILABLE');
  const specs:{stage:string;path:string;params:Record<string,string>}[]=[{stage:'RG_ORDERS',path:`/v2/providers/rg_open_api/apis/api/v1/vendors/${cred.vendorId}/rg/orders`,params:{paidDateFrom:day.replace(/-/g,''),paidDateTo:next.replace(/-/g,'')}},
    {stage:'WING_ORDERS',path:`/v2/providers/openapi/apis/api/v4/vendors/${cred.vendorId}/ordersheets`,params:{createdAtFrom:day,createdAtTo:next,status:'ACCEPT'}}];
  for(const spec of specs){const probe:Raw={stage:spec.stage,method:'GET',state:'NOT_STARTED',http_status:null,order_count:0,item_count:0,quantity_field_rows:0,payment_field_rows:0,has_more:false};result.probes.push(probe);
    const left=deps.deadline-now();if(left<=0){probe.state='TIMEOUT';return finish('FAILED','TIME_BUDGET');}
    const signal=AbortSignal.timeout(Math.min(5000,left));let response:Response;
    try{const signed=deps.sign('GET',spec.path,spec.params,cred);result.requests++;
      response=await deps.request(signed.url,{method:'GET',cache:'no-store',signal,headers:{Authorization:signed.authorization,'X-Requested-By':cred.vendorId,'Content-Type':'application/json;charset=UTF-8'}});
    }catch{probe.state=signal.aborted?'TIMEOUT':'NETWORK_FAILED';return finish('FAILED',probe.state);}
    probe.http_status=response.status;
    let payload;try{payload=await boundedJson(response);}catch{probe.state='RESPONSE_INVALID';return finish('FAILED',response.ok?'RESPONSE_INVALID':'HTTP_FAILED');}
    if(!response.ok){probe.state='HTTP_FAILED';const denied=response.status===403&&typeof payload?.message==='string'&&/ip address[^\n]{0,160}not allowed/i.test(payload.message);
      return finish('FAILED',denied?'IP_REJECTED':'HTTP_FAILED');}
    if(payload?.code!=null&&String(payload.code)!=='200'){probe.state='PROVIDER_REJECTED';return finish('FAILED','PROVIDER_REJECTED');}
    if(!Array.isArray(payload?.data)||payload.data.length>50){probe.state='RESPONSE_INVALID';return finish('FAILED','RESPONSE_INVALID');}
    probe.order_count=payload.data.length;probe.has_more=typeof payload.nextToken==='string'&&payload.nextToken.length>0;
    for(const order of payload.data){if(!Array.isArray(order?.orderItems)){probe.state='ITEMS_UNCONFIRMED';return finish('FAILED','ORDER_ITEMS_INVALID');}
      for(const item of order.orderItems){probe.item_count++;if(probe.item_count>500){probe.state='RESPONSE_LIMIT';return finish('FAILED','ITEM_LIMIT');}
        const quantity=spec.stage==='RG_ORDERS'?item?.salesQuantity:item?.shippingCount;
        if(Number.isSafeInteger(quantity)&&quantity>=0)probe.quantity_field_rows++;
        if(typeof item?.orderPrice==='number'&&Number.isFinite(item.orderPrice)&&item.orderPrice>=0)probe.payment_field_rows++;}}
    probe.state='HTTP_OK';
  }
  return finish(result.probes.every((probe:Raw)=>probe.order_count===0)?'EMPTY_RANGE':'READ_COMPLETED','NONE');
}
export async function runOrdersReadOnly(day:string,deadline:number){
  const verified=['https://15.165.83.123','https://15.165.83.123/'].includes(process.env.COUPANG_PROXY_URL??'')&&(process.env.COUPANG_PROXY_SECRET?.length??0)>=32;
  return collectOrdersReadOnly(day,{verified,deadline,sign:buildCoupangAuth,request:relayFetch,load:async()=>{
    const remaining=deadline-Date.now();if(remaining<=0)return null;const admin=await createAdminClient();
    const {data,error}=await admin.from('coupang_credentials').select('access_key,secret_key,vendor_id').order('updated_at',{ascending:false}).limit(1).abortSignal(AbortSignal.timeout(Math.min(3000,remaining))).maybeSingle();
    if(error||!data||typeof data.access_key!=='string'||typeof data.secret_key!=='string'||typeof data.vendor_id!=='string')return null;
    return {accessKey:data.access_key,secretKey:data.secret_key,vendorId:data.vendor_id};
  }});
}
