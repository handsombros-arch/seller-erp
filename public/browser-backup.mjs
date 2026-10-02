// Same-origin, local-only migration. No fetch, credentials, cookies, or cloud writes.
export const DB = 'lv-erp-ad';
export const STORE = 'rawRows';
const exact = new Set(['exchange_processed','forecast_discontinued','lv-theme','vat_on','inv_sum_cols','inv_rg_cols','inv_wh_cols','master_expanded','master_product_order','dash_trend_skus','dash_trend_days']);
export function allowedKey(key) {
  return exact.has(key) || /^(lv-erp-|data-analysis\.|orders-visible-cols-)/.test(key);
}
const request = r => new Promise((resolve,reject) => { r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error); });
const done = tx => new Promise((resolve,reject) => { tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error||Error('저장 작업 취소'));tx.onerror=()=>reject(tx.error); });
function encode(value) { return JSON.stringify(value,function(k,v){return this[k] instanceof Date ? {$erpDate:this[k].toISOString()} : v;}); }
function decode(text) { return JSON.parse(text,(k,v)=>v && typeof v==='object' && Object.keys(v).length===1 && typeof v.$erpDate==='string' ? new Date(v.$erpDate) : v); }
export async function digest(text) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join(''); }
async function open(create=false) {
  const databases = await indexedDB.databases();
  if (!databases.some(d=>d.name===DB) && !create) return null;
  const req=indexedDB.open(DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(STORE))req.result.createObjectStore(STORE);};
  const db=await request(req);
  if (!db.objectStoreNames.contains(STORE)) { db.close();throw Error('예상한 광고 저장소가 없습니다.'); }
  return db;
}
export async function snapshot() {
  const settings={};
  for(const key of Object.keys(localStorage).filter(allowedKey).sort())settings[key]=localStorage.getItem(key);
  const db=await open();let records=[];
  if(db)try{
    const tx=db.transaction(STORE,'readonly');const finished=done(tx);const store=tx.objectStore(STORE);
    const [keys,values]=await Promise.all([request(store.getAllKeys()),request(store.getAll())]);await finished;
    records=keys.map((key,i)=>({key,value:values[i]}));
  }finally{db.close();}
  return {settings,records};
}
function numeric(v){const n=Number(String(v??'').replace(/,/g,''));return Number.isFinite(n)?n:0;}
export function summarize(data) {
  return {settings:Object.keys(data.settings).length,records:data.records.map(({key,value})=>{
    const list=Array.isArray(value)?value:[];let missingDate=0;
    const months={};let cost=0,clicks=0,impressions=0,orders=0,revenue=0;
    for(const row of list){
      const raw=row['날짜'];const date=String(raw??'').trim();
      const m=date.match(/^(\d{4})[-/.]?(\d{2})/);const month=m?`${m[1]}-${m[2]}`:'날짜 확인 필요';
      months[month]=(months[month]||0)+1;if(raw==null||raw==='')missingDate++;
      cost+=numeric(row['광고비']);clicks+=numeric(row['클릭수']);impressions+=numeric(row['노출수']);orders+=numeric(row['총 주문수(14일)']);revenue+=numeric(row['총 전환매출액(14일)']);
    }
    return {key,rows:list.length,months,missingDate,cost,clicks,impressions,orders,revenue};
  })};
}
export async function envelope(data){const payload=encode(data);return {format:'lv-erp-browser-backup',version:1,origin:location.origin,createdAt:new Date().toISOString(),sha256:await digest(payload),summary:summarize(data),payload};}
export async function validate(file){
  if(file.format!=='lv-erp-browser-backup'||file.version!==1||typeof file.payload!=='string')throw Error('지원하지 않는 백업 파일입니다.');
  if(file.origin!==location.origin)throw Error('백업한 ERP 주소와 현재 주소가 다릅니다.');
  if(await digest(file.payload)!==file.sha256)throw Error('파일 무결성 검사 실패');
  const data=decode(file.payload);
  if(!data||!data.settings||!Array.isArray(data.records))throw Error('백업 구조 오류');
  for(const [k,v] of Object.entries(data.settings))if(!allowedKey(k)||typeof v!=='string')throw Error('허용되지 않은 설정 항목');
  const keys=new Set();
  for(const r of data.records){if(typeof r.key!=='string'||!Array.isArray(r.value)||keys.has(r.key))throw Error('광고 저장 항목 오류');keys.add(r.key);}
  return data;
}
export function assertCompatible(current,incoming){
  for(const [k,v] of Object.entries(current.settings))if(k in incoming.settings&&v!==incoming.settings[k])throw Error(`기존 설정 충돌: ${k}. 기존 데이터를 보존하고 중단했습니다.`);
  const wanted=new Map(incoming.records.map(r=>[r.key,encode(r.value)]));
  for(const r of current.records)if(!wanted.has(r.key)||wanted.get(r.key)!==encode(r.value))throw Error(`기존 광고 데이터 충돌: ${r.key}. 빈 브라우저에서 복원하세요.`);
}
export async function restore(data){
  const before=await snapshot();
  for(const [k,v]of Object.entries(before.settings))if(k in data.settings&&v!==data.settings[k])throw Error(`기존 설정 충돌: ${k}`);
  const incoming=new Map((await fingerprints(data)).records.map(r=>[r.key,JSON.stringify(r)]));
  for(const r of (await fingerprints(before)).records)if(incoming.get(r.key)!==JSON.stringify(r))throw Error(`기존 광고 데이터 충돌: ${r.key}`);
  const added=[];
  try{
    for(const [k,v]of Object.entries(data.settings))if(localStorage.getItem(k)===null){localStorage.setItem(k,v);added.push(k);}
    const db=await open(true);
    try{
      const tx=db.transaction(STORE,'readwrite');const finished=done(tx);const store=tx.objectStore(STORE);
      // Never replace any existing key, including keys written concurrently.
      const keys=store.getAllKeys();
      keys.onsuccess=()=>{const existing=new Set(keys.result);for(const r of data.records)if(!existing.has(r.key))store.add(r.value,r.key);};await finished;
    }finally{db.close();}
  }catch(error){for(const k of added)if(localStorage.getItem(k)===data.settings[k])localStorage.removeItem(k);throw error;}
}
export async function compare(data){
  const actual=await snapshot();
  const expected=await digest(JSON.stringify(await fingerprints(data)));const found=await digest(JSON.stringify(await fingerprints(actual)));
  if(expected!==found)throw Error('현재 데이터와 백업이 완전히 일치하지 않습니다. 기존의 추가 설정이나 다른 ERP 탭의 변경을 확인하세요.');
  return {verified:true,sha256:found,summary:summarize(actual)};
}
const CHUNK=10000;
export async function fingerprints(data){
  const settings=Object.fromEntries(Object.entries(data.settings).sort(([a],[b])=>a.localeCompare(b)));
  const records=[];
  for(const r of data.records){const hashes=[];for(let i=0;i<r.value.length;i+=CHUNK)hashes.push(await digest(encode(r.value.slice(i,i+CHUNK))));records.push({key:r.key,rows:r.value.length,hashes});}
  records.sort((a,b)=>a.key.localeCompare(b.key));return {settings,records};
}
// JSONL chunks keep each string below browser limits even for millions of rows.
export async function archive(data){
  const manifest=await fingerprints(data);const header={format:'lv-erp-browser-chunks',version:1,origin:location.origin,createdAt:new Date().toISOString(),manifest,sha256:await digest(JSON.stringify(manifest))};
  async function* lines(){yield JSON.stringify(header)+'\n';for(const r of data.records)for(let i=0;i<r.value.length;i+=CHUNK)yield JSON.stringify({key:r.key,index:i/CHUNK,payload:encode(r.value.slice(i,i+CHUNK))})+'\n';}
  const iterator=lines();const stream=new ReadableStream({async pull(controller){const item=await iterator.next();if(item.done)controller.close();else controller.enqueue(new TextEncoder().encode(item.value));}});
  return {blob:await new Response(stream.pipeThrough(new CompressionStream('gzip'))).blob(),sha256:header.sha256,summary:summarize(data)};
}
export async function readArchive(stream){
  const reader=stream.pipeThrough(new TextDecoderStream()).getReader();let buffer='',header=null;const records=new Map();let seen=0;
  async function line(text){
    const item=JSON.parse(text);
    if(!header){header=item;if(header.format!=='lv-erp-browser-chunks'||header.version!==1||header.origin!==location.origin)throw Error('백업 형식 또는 ERP 주소가 다릅니다.');
      if(await digest(JSON.stringify(header.manifest))!==header.sha256)throw Error('목록 무결성 검사 실패');
      for(const[k,v]of Object.entries(header.manifest.settings))if(!allowedKey(k)||typeof v!=='string')throw Error('허용되지 않은 설정');
      for(const r of header.manifest.records){if(typeof r.key!=='string'||records.has(r.key)||!Number.isSafeInteger(r.rows)||r.rows<0||!Array.isArray(r.hashes)||r.hashes.length!==Math.ceil(r.rows/CHUNK))throw Error('저장 목록 오류');records.set(r.key,{key:r.key,value:[],hashes:r.hashes,rows:r.rows,seen:0});}return;
    }
    const r=records.get(item.key);if(!r||item.index!==r.seen||typeof item.payload!=='string'||await digest(item.payload)!==r.hashes[item.index])throw Error('원본 조각 무결성 검사 실패');
    const rows=decode(item.payload);if(!Array.isArray(rows)||rows.length!==Math.min(CHUNK,r.rows-r.value.length))throw Error('원본 행 수 오류');for(const row of rows)r.value.push(row);r.seen++;seen++;
  }
  try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=value;let end;while((end=buffer.indexOf('\n'))>=0){const text=buffer.slice(0,end);buffer=buffer.slice(end+1);if(text)await line(text);}}if(buffer.trim())await line(buffer);}finally{reader.releaseLock();}
  if(!header)throw Error('빈 파일');
  for(const r of records.values())if(r.seen!==r.hashes.length||r.value.length!==r.rows)throw Error('백업 파일이 잘렸습니다.');
  return {settings:header.manifest.settings,records:Array.from(records.values(),r=>({key:r.key,value:r.value}))};
}
if(typeof document!=='undefined'){
  const $=id=>document.getElementById(id);let selected=null;let busy=false;
  const show=v=>{$('status').textContent=typeof v==='string'?v:JSON.stringify(v,null,2);};
  const run=async work=>{if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await work();}catch(e){show(`중단: ${e.message}`);}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);for(const id of ['verify','restore','compare'])$(id).disabled=!selected;}};
  $('file').onchange=()=>{selected=$('file').files[0]||null;for(const id of ['verify','restore','compare'])$(id).disabled=!selected;};
  async function load(){if(!selected)throw Error('파일을 선택하세요.');let stream=selected.stream();if(selected.name.endsWith('.gz'))stream=stream.pipeThrough(new DecompressionStream('gzip'));return readArchive(stream);}
  $('inspect').onclick=()=>run(async()=>{show('저장소 읽는 중…');show(summarize(await snapshot()));});
  $('export').onclick=()=>run(async()=>{
    show('원본을 그대로 읽고 압축하는 중…');const data=await snapshot();const file=await archive(data);
    const url=URL.createObjectURL(file.blob);const a=document.createElement('a');a.href=url;a.download=`erp-browser-${new Date().toISOString().replace(/[:.]/g,'-')}.jsonl.gz`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    show({message:'백업 파일 생성 완료. 다운로드 파일을 선택하고 파일과 현재 데이터 대조를 실행하세요.',sha256:file.sha256,bytes:file.blob.size,summary:file.summary});
  });
  $('verify').onclick=()=>run(async()=>{show('파일 검증 중…');show({message:'파일 무결성 검사 통과',summary:summarize(await load())});});
  $('restore').onclick=()=>run(async()=>{show('파일 검증 및 복원 중…');const data=await load();await restore(data);show(await compare(data));});
  $('compare').onclick=()=>run(async()=>{show('전체 원본·설정 대조 중…');show(await compare(await load()));});
}
