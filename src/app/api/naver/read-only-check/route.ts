import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
import {runReadOnly,validateRange} from '@/lib/naver/read-only-diagnostic';
export const dynamic='force-dynamic';
export const maxDuration=30;
type Entry={id:string;at:number;result:Record<string,unknown>};
const records=new Map<string,Entry>();let active=false;
const valid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
function reply(data:Record<string,unknown>,status=200){return NextResponse.json({checked_utc:new Date().toISOString(),commit:process.env.VERCEL_GIT_COMMIT_SHA??null,limit_scope:'FUNCTION_INSTANCE_AND_BROWSER',...data},{status,headers:{'Cache-Control':'no-store'}});}
async function user(){let timer:ReturnType<typeof setTimeout>|undefined;try{return await Promise.race([(async()=>{const c=await createClient();const r=await c.auth.getUser();return r.error?null:r.data.user;})(),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),4000);})]);}catch{return null;}finally{if(timer)clearTimeout(timer);}}
export async function GET(request:NextRequest){const actor=await user();if(!actor)return reply({state:'BLOCKED',error_code:'AUTH_REQUIRED_OR_UNAVAILABLE'},401);
  const id=request.nextUrl.searchParams.get('request_id');if(!valid(id))return reply({state:'BLOCKED',error_code:'REQUEST_ID_REQUIRED'},400);
  const saved=records.get(actor.id);return reply(saved?.id===id?saved.result:{state:'UNKNOWN_NO_REPLAY',error_code:'INSTANCE_RESULT_UNAVAILABLE',provider_requests:0});}
export async function POST(request:NextRequest){const deadline=Date.now()+22000;
  if(request.headers.get('origin')!==request.nextUrl.origin)return reply({state:'BLOCKED',error_code:'ORIGIN_REJECTED'},403);
  const actor=await user();if(!actor)return reply({state:'BLOCKED',error_code:'AUTH_REQUIRED_OR_UNAVAILABLE'},401);
  const body=await request.json().catch(()=>null);if(!body||Object.keys(body).some(key=>!['request_id','from','to'].includes(key))||!valid(body.request_id))return reply({state:'BLOCKED',error_code:'REQUEST_INVALID'},400);
  const range=validateRange(body);if(!range)return reply({state:'BLOCKED',error_code:'RANGE_MAX_24H_WITHIN_7D'},400);
  const prior=records.get(actor.id);if(prior&&prior.id===body.request_id)return reply(prior.result);
  if(active||prior&&Date.now()-prior.at<60000)return reply({state:'BLOCKED',error_code:'RATE_LIMITED',provider_requests:0},429);
  for(const [key,row]of records)if(Date.now()-row.at>300000)records.delete(key);
  if(records.size>=64)return reply({state:'BLOCKED',error_code:'INSTANCE_CAPACITY',provider_requests:0},429);
  const entry:Entry={id:body.request_id,at:Date.now(),result:{state:'PENDING',error_code:'READ_RESULT_ONLY'}};records.set(actor.id,entry);active=true;
  try{entry.result=await runReadOnly(range,deadline);return reply(entry.result);}
  catch{entry.result={state:'REQUEST_UNCERTAIN',error_code:'READ_RESULT_ONLY'};return reply(entry.result,502);}
  finally{active=false;}
}
