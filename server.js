import express from 'express';
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const app=express();
const __dirname=path.dirname(fileURLToPath(import.meta.url));
app.use(express.static(path.join(__dirname,'public')));
const parseVariants=(prefix,model)=>{const parts=(process.env[prefix+'_PARTS']||'').split(',').map(s=>s.trim()).filter(Boolean);const labels=(process.env[prefix+'_LABELS']||'').split(',').map(s=>s.trim());return parts.map((part,i)=>{const label=labels[i]||part;const storage=(label.match(/(256GB|512GB|1TB|2TB)/i)||[])[0]||'';const color=label.replace(/(256GB|512GB|1TB|2TB)/ig,'').trim();return {part,label,model,color,storage}})};
const variants=[...parseVariants('DUO','duo'),...parseVariants('PRO_MAX','pro')];const parts=variants.map(v=>v.part);const labels=variants.map(v=>v.label);
const CACHE_MS=Math.max(600000,Number(process.env.CACHE_SECONDS||600)*1000);
const cache=new Map(), history=[];
let blockedUntil=0,scanning=false,nextAppleRequestAt=0;
const scanCache=new Map();
const blockMessage="Apple declined inventory requests (HTTP 541). Live availability cannot be verified. Checks are paused for 15 minutes; confirm pickup on apple.com.";
const seeds=['32084','10001','02108','19103','20001','30303','33131','37203','43215','48226','55401','60601','63101','64106','70112','75201','77002','78205','80202','84101','85004','87102','89101','90012','92101','94103','95113','97204','98101','96813','99501'];
const extra=(process.env.EXTRA_ZIPS||'').split(',').map(s=>s.trim()).filter(s=>/^\d{5}$/.test(s));
const usZips=[...new Set([...seeds,...extra])];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function getZip(zip){
 if(Date.now()<blockedUntil)throw new Error(blockMessage);
 const old=cache.get(zip); if(old&&Date.now()-old.at<CACHE_MS)return old.data;
 const merged=new Map();
 // Apple may omit trailing parts in large requests. Check at most 12 at a time.
 for(let offset=0;offset<parts.length;offset+=12){
  const url=new URL('https://www.apple.com/shop/retail/pickup-message');
  url.searchParams.set('pl','true');url.searchParams.set('location',zip);
  parts.slice(offset,offset+12).forEach((part,i)=>url.searchParams.set(`parts.${i}`,part));
  await sleep(Math.max(0,nextAppleRequestAt-Date.now()));
  if(Date.now()<blockedUntil)throw new Error(blockMessage);
  nextAppleRequestAt=Date.now()+3000;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
   const response=await fetch(url,{signal:controller.signal,headers:{'Accept':'application/json','User-Agent':'Mozilla/5.0 (compatible; DuoRadar/1.0)'}});
   if(response.status===541){blockedUntil=Date.now()+15*60*1000;throw new Error(blockMessage)}
   if(!response.ok)throw new Error(`Apple returned HTTP ${response.status}`);
   const batch=await response.json();
   if(!Array.isArray(batch?.body?.stores))throw new Error('Apple response did not contain stores');
   for(const s of batch.body.stores){
    const id=String(s.storeNumber||s.storeId||s.storeName),old=merged.get(id);
    if(old)old.partsAvailability={...old.partsAvailability,...s.partsAvailability};
    else merged.set(id,s);
   }
  }finally{clearTimeout(timeout)}
  if(offset+12<parts.length)await sleep(150);
 }
 const json={body:{stores:[...merged.values()]}};
  const data=json.body.stores.map(s=>({id:String(s.storeNumber||s.storeId||s.storeName),name:s.storeName||'Apple Store',city:s.city||s.address?.city||'',state:s.state||s.address?.state||'',address:s.address?.address||s.address?.street||'',zip:s.address?.postalCode||'',availability:parts.map((part,i)=>({part,label:labels[i]||part,status:s.partsAvailability?.[part]?.pickupDisplay||'unknown',quote:s.partsAvailability?.[part]?.pickupSearchQuote||''}))}));
  cache.set(zip,{at:Date.now(),data});return data;

}
function track(stores){
 const now=new Date().toISOString();
 for(const store of stores)for(const a of store.availability){
  const key=`${store.id}:${a.part}`,current=a.status==='available';
  if(!track.previous)track.previous=new Map();
  const previous=track.previous.get(key);
  if(previous===false&&current){history.unshift({time:now,store:store.name,city:store.city,label:a.label,part:a.part});history.length=Math.min(100,history.length)}
  if(a.status!=='unknown')track.previous.set(key,current);
 }
}
app.get('/api/config',(_req,res)=>res.json({configured:parts.length>0,variants,seedCount:usZips.length,cacheSeconds:CACHE_MS/1000}));
app.get('/api/history',(_req,res)=>res.json({events:history,note:'Events observed by this running server only; no historical database.'}));
app.get('/api/stock',async(req,res)=>{
 if(!parts.length)return res.status(503).json({error:'Set DUO_PARTS and/or PRO_MAX_PARTS in .env before live checks can run.'});
 if(Date.now()<blockedUntil)return res.status(503).json({error:blockMessage,code:'APPLE_BLOCKED',retryAfterSeconds:Math.ceil((blockedUntil-Date.now())/1000)});
 const zip=String(req.query.zip||'32084'),scope=String(req.query.scope||'local');
 if(!/^\d{5}$/.test(zip))return res.status(400).json({error:'Enter a valid five-digit US ZIP.'});
 const scanKey=zip+':'+scope,previousScan=scanCache.get(scanKey);
 if(previousScan&&Date.now()-previousScan.at<CACHE_MS)return res.json({...previousScan.data,cached:true});
 if(scanning)return res.status(429).json({error:'An inventory scan is already running. Please wait before checking again.'});
 const zips=scope==='local'?[zip]:[zip,...usZips.filter(z=>z!==zip)];
 scanning=true;
 try{
 const found=new Map(),errors=[];
 // Sequential with delay avoids burst traffic against Apple's undocumented endpoint.
 for(const z of zips){
  try{for(const s of await getZip(z)){
   const prev=found.get(s.id);
   if(!prev)found.set(s.id,s);
   else for(const a of s.availability){const old=prev.availability.find(v=>v.part===a.part);if(old&&old.status==='unknown')Object.assign(old,a)}
  }}catch(e){errors.push({zip:z,message:e.message});if(Date.now()<blockedUntil)break;}
  if(zips.length>1)await sleep(150);
 }
 const stores=[...found.values()].sort((a,b)=>a.name.localeCompare(b.name));
 if(stores.length)track(stores);
 if(Date.now()<blockedUntil)return res.status(503).json({error:blockMessage,code:'APPLE_BLOCKED',retryAfterSeconds:Math.ceil((blockedUntil-Date.now())/1000),stores:[],errors});
 const observedAt=Math.min(...zips.map(z=>cache.get(z)?.at||Date.now()));
 const result={checkedAt:new Date(observedAt).toISOString(),scope,zip,regionsChecked:zips.length,stores,errors,partial:errors.length>0,cached:false,disclaimer:'Nationwide is best-effort ZIP sampling, not guaranteed coverage of every US Apple Store.'};
 if(stores.length&&!errors.length)scanCache.set(scanKey,{at:Date.now(),data:result});
 res.status(stores.length?200:502).json(result);
 }finally{scanning=false}
});
app.listen(Number(process.env.PORT||3000),()=>console.log(`DuoRadar http://localhost:${process.env.PORT||3000}`));
