import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {runOrdersReadOnly,validateDay} from '@/lib/coupang/orders-read-only';
export const dynamic='force-dynamic';export const maxDuration=30;
const records=new Map<string,{id:string;at:number;result:Record<string,unknown>}>();let active=false;
const valid=(id:unknown):id is string=>typeof id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id);
function reply(value:Record<string,unknown>,status=200){return NextResponse.json({checked_utc:new Date().toISOString(),commit:process.env.VERCEL_GIT_COMMIT_SHA??null,limit_scope:'FUNCTION_INSTANCE_AND_BROWSER',...value},{status,headers:{'Cache-Control':'no-store'}});}
async function user(){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([(async()=>{const c=await createClient();const r=await c.auth.getUser();return r.error?null:r.data.user;})(),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),4000);})]);}catch{return null;}finally{if(timer)clearTimeout(timer);}}
export async function GET(request:NextRequest){const actor=await user();if(!actor)return reply({state:'BLOCKED',error_code:'AUTH_REQUIRED_OR_UNAVAILABLE'},401);const id=request.nextUrl.searchParams.get('request_id');if(!valid(id))return reply({state:'BLOCKED',error_code:'REQUEST_ID_REQUIRED'},400);const row=records.get(actor.id);return reply(row?.id===id?row.result:{state:'UNKNOWN_NO_REPLAY',error_code:'INSTANCE_RESULT_UNAVAILABLE'});}
export async function POST(request:NextRequest){const deadline=Date.now()+22000;if(request.headers.get('origin')!==request.nextUrl.origin)return reply({state:'BLOCKED',error_code:'ORIGIN_REJECTED'},403);
  const actor=await user();if(!actor)return reply({state:'BLOCKED',error_code:'AUTH_REQUIRED_OR_UNAVAILABLE'},401);const body=await request.json().catch(()=>null);
  if(!body||Object.keys(body).some(k=>!['request_id','date'].includes(k))||!valid(body.request_id))return reply({state:'BLOCKED',error_code:'REQUEST_INVALID'},400);
  const day=validateDay(body.date);if(!day)return reply({state:'BLOCKED',error_code:'COMPLETED_UTC_DAY_WITHIN_7D_REQUIRED'},400);
  const old=records.get(actor.id);if(old&&old.id===body.request_id)return reply(old.result);if(active||old&&Date.now()-old.at<60000)return reply({state:'BLOCKED',error_code:'RATE_LIMITED'},429);
  for(const[key,row]of records)if(Date.now()-row.at>300000)records.delete(key);if(records.size>=64)return reply({state:'BLOCKED',error_code:'INSTANCE_CAPACITY'},429);
  const row={id:body.request_id,at:Date.now(),result:{state:'PENDING',error_code:'READ_RESULT_ONLY'} as Record<string,unknown>};records.set(actor.id,row);active=true;
  try{row.result=await runOrdersReadOnly(day,deadline);return reply(row.result);}catch{row.result={state:'REQUEST_UNCERTAIN',error_code:'READ_RESULT_ONLY'};return reply(row.result,502);}finally{active=false;}
}
