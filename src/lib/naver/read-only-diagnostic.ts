import bcrypt from 'bcryptjs';
import { createAdminClient } from '@/lib/supabase/server';
import { relayFetch } from '@/lib/api-relay';
type Raw = Record<string, any>;
export type ReadRange = { from: string; to: string };
export function validateRange(value: unknown, now = Date.now()): ReadRange | null {
  const v = value as Raw | null;
  if (!v || typeof v.from !== 'string' || typeof v.to !== 'string' || !/^\d{4}-\d\d-\d\dT.*Z$/.test(v.from) || !/^\d{4}-\d\d-\d\dT.*Z$/.test(v.to)) return null;
  const from = Date.parse(v.from), to = Date.parse(v.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to-from > 86400000 || to > now+60000 || from < now-7*86400000) return null;
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}
async function limitedJson(response: Response, limit: number) {
  if (!response.body) throw new Error('SCHEMA_INVALID');
  const reader=response.body.getReader(), parts: Uint8Array[]=[]; let size=0;
  try { while(true) { const next=await reader.read(); if(next.done)break; size+=next.value.byteLength;
    if(size>limit)throw new Error('RESPONSE_LIMIT');parts.push(next.value); }
    const bytes=new Uint8Array(size); let offset=0; for(const part of parts){bytes.set(part,offset);offset+=part.length;}
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally { try{await reader.cancel();}catch{} }
}
export async function collectReadOnly(range: ReadRange, deps: {
  load: () => Promise<{clientId:string;clientSecret:string}|null>;
  request: (url:string,init:RequestInit)=>Promise<Response>;
  relayVerified:boolean; deadline:number; now?:()=>number;
}) {
  const now=deps.now??Date.now, started=now();
  const result: Raw={state:'BLOCKED',error_code:'NOT_STARTED',range,checked_utc:new Date().toISOString(),
    relay_endpoint_verified:deps.relayVerified,relay_host:'15.165.83.123',egress_ip_independently_observed:false,
    max_pages:1,max_orders:5,automatic_retries:0,db_write_attempts:0,inventory_changes:0,requests:0,
    list_rows:0,detail_rows:0,quantity_field_rows:0,payment_amount_field_rows:0,stages:[]};
  const finish=(state:string,code:string)=>({...result,state,error_code:code,checked_utc:new Date().toISOString(),elapsed_ms:Math.max(0,now()-started)});
  if(!deps.relayVerified)return finish('BLOCKED','RELAY_CONFIG_REQUIRED');
  let credentials;
  try { credentials=await deps.load(); } catch { return finish('BLOCKED','CREDENTIALS_UNAVAILABLE'); }
  if(!credentials)return finish('BLOCKED','CREDENTIALS_UNAVAILABLE');
  let failed=false;
  const request=async(stage:string,method:'GET'|'POST',path:string,headers:Record<string,string>,body?:string)=>{
    const entry:Raw={stage,method,http_status:null,state:'STARTED'};result.stages.push(entry);
    const left=deps.deadline-now();if(left<=0){entry.state='TIMEOUT';failed=true;return null;}
    const signal=AbortSignal.timeout(Math.min(5000,left));
    let response:Response;
    try {result.requests++;response=await deps.request('https://api.commerce.naver.com'+path,{method,headers,body,signal,cache:'no-store'});}
    catch {entry.state=signal.aborted?'TIMEOUT':'NETWORK_FAILED';failed=true;return null;}
    entry.http_status=Number.isInteger(response.status)&&response.status>=100&&response.status<=599?response.status:null;
    if(!response.ok){entry.state='HTTP_FAILED';failed=true;try{await response.body?.cancel();}catch{}return null;}
    try {const payload=await limitedJson(response,stage==='TOKEN'?16384:262144);entry.state='HTTP_OK';return payload;}
    catch {entry.state=signal.aborted?'TIMEOUT':'RESPONSE_INVALID';failed=true;return null;}
  };
  let sign;
  try {const timestamp=String(now());sign=new URLSearchParams({grant_type:'client_credentials',client_id:credentials.clientId,timestamp,
    client_secret_sign:Buffer.from(bcrypt.hashSync(credentials.clientId+'_'+timestamp,credentials.clientSecret)).toString('base64'),type:'SELF'}).toString();}
  catch {return finish('BLOCKED','AUTH_SIGNING_FAILED');}
  const token=await request('TOKEN','POST','/external/v1/oauth2/token',{'Content-Type':'application/x-www-form-urlencoded'},sign);
  if(failed)return finish('FAILED','TOKEN_REQUEST_FAILED');
  if(typeof token?.access_token!=='string'||!token.access_token||token.access_token.length>8192)return finish('FAILED','TOKEN_RESPONSE_INVALID');
  const headers={Authorization:'Bearer '+token.access_token,'Content-Type':'application/json'};
  const query=new URLSearchParams({from:range.from,to:range.to,page:'1',pageSize:'5'});
  const list=await request('ORDER_LIST','GET','/external/v1/pay-order/seller/product-orders?'+query.toString(),headers);
  if(failed)return finish('FAILED','ORDER_LIST_FAILED');
  const rows=list?.data?.contents;
  if(!Array.isArray(rows)||rows.length>5)return finish('FAILED','ORDER_LIST_RESPONSE_INVALID');
  result.list_rows=rows.length;
  if(!rows.length)return finish('EMPTY_RANGE','NONE');
  const ids=rows.map((row:Raw)=>row?.productOrderId??row?.content?.productOrderId??row?.productOrder?.productOrderId??row?.content?.productOrder?.productOrderId);
  if(ids.some((id:unknown)=>typeof id!=='string'||!/^\d{1,32}$/.test(id))||new Set(ids).size!==ids.length)return finish('FAILED','ORDER_IDS_INVALID');
  // Official product-orders/query is a read-only detail lookup, not order processing.
  const detail=await request('ORDER_DETAILS','POST','/external/v1/pay-order/seller/product-orders/query',headers,JSON.stringify({productOrderIds:ids}));
  if(failed)return finish('FAILED','ORDER_DETAILS_FAILED');
  const data=detail?.data;
  if(!Array.isArray(data)||data.length>5)return finish('FAILED','ORDER_DETAILS_RESPONSE_INVALID');
  result.detail_rows=data.length;
  const returned=data.map((row:Raw)=>row?.productOrder?.productOrderId??row?.productOrderId);
  if(returned.some((id:unknown)=>!ids.includes(id))||new Set(returned).size!==returned.length||returned.length!==ids.length)return finish('FAILED','ORDER_DETAILS_INCOMPLETE');
  result.quantity_field_rows=data.filter((row:Raw)=>Number.isSafeInteger(row?.productOrder?.quantity)&&row.productOrder.quantity>=0).length;
  result.payment_amount_field_rows=data.filter((row:Raw)=>typeof row?.productOrder?.totalPaymentAmount==='number'&&Number.isFinite(row.productOrder.totalPaymentAmount)&&row.productOrder.totalPaymentAmount>=0).length;
  return finish('READ_COMPLETED','NONE');
}
export async function runReadOnly(range: ReadRange, deadline:number) {
  const verified=['https://15.165.83.123','https://15.165.83.123/'].includes(process.env.COUPANG_PROXY_URL??'') && (process.env.COUPANG_PROXY_SECRET?.length??0)>=32;
  return collectReadOnly(range,{relayVerified:verified,deadline,request:relayFetch,load:async()=>{
    const left=deadline-Date.now();if(left<=0)throw new Error('DEADLINE');
    const admin=await createAdminClient();
    const {data,error}=await admin.from('naver_credentials').select('client_id,client_secret').order('updated_at',{ascending:false}).limit(1).abortSignal(AbortSignal.timeout(Math.min(3000,left))).maybeSingle();
    if(error||!data||typeof data.client_id!=='string'||typeof data.client_secret!=='string'||!data.client_id||!data.client_secret)return null;
    return {clientId:data.client_id,clientSecret:data.client_secret};
  }});
}
