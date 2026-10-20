import assert from 'node:assert/strict';
import { onRequest as availability } from '../functions/api/availability.js';
import { onRequest as events } from '../functions/api/admin/events.js';
import { tokyoNow } from '../functions/lib/utils.js';
function future(n=2) {
  const today=tokyoNow().date;
  const d=new Date(today+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);
  return d.toISOString().slice(0,10);
}
class FakeDB {
  constructor({holiday=false,appointments=[]}={}){this.holiday=holiday;this.appointments=appointments;}
  prepare(query){const b={params:[],bind(...args){this.params=args;return this},all:async()=>{
    if(query.includes('FROM settings WHERE key IN'))return {results:[{key:'business_hours',value:JSON.stringify({'0':null,...Object.fromEntries([1,2,3,4,5,6].map(i=>[i,['10:00','19:00']]))})},{key:'slot_minutes',value:'30'}]};
    if(query.includes('FROM breaks'))return {results:[]};
    if(query.includes('FROM appointments'))return {results:this.appointments};
    return {results:[]};
  },first:async()=>{
    if(query.includes('FROM holidays'))return this.holiday?{date:b.params[0]}:null;
    if(query.includes('FROM sessions'))return null;
    return null;
  }};b.owner=this;return b}
}
const date=future(2);
const db=new FakeDB({appointments:[{id:'SHOULD_HIDE_ID',name:'SHOULD_HIDE_NAME',time:'14:30',duration_minutes:30}]});
const request=new Request('https://example.test/api/availability?date='+date+'&extension=0');
const response=await availability({request,env:{DB:db}});
assert.equal(response.status,200);
const payload=await response.json();
assert.equal('booked' in payload,false);
assert.equal('breaks' in payload,false);
assert.equal('settings' in payload,false);
assert(!JSON.stringify(payload).includes('SHOULD_HIDE'));
assert.equal(payload.slots.find(x=>x.time==='14:30')?.status,'booked');
console.log('PASS: public availability preserves booked state without patient info');
const holidayDB=new FakeDB({holiday:true});
const holidayResponse=await availability({request,env:{DB:holidayDB}});
const holiday=await holidayResponse.json();
assert.equal(holiday.holiday,true);
assert.equal(holiday.slots.length,0);
console.log('PASS: configured holiday has no available times');
const eventRes=await events({request:new Request('https://example.test/api/admin/events'),env:{DB:db}});
assert.equal(eventRes.status,401);
console.log('PASS: anonymous access to notification feed denied');
const seed='reservation_event:0000000000000:00000000-0000-0000-0000-000000000000';
const fakeEventId='reservation_event:1790000000000:123e4567-e89b-12d3-a456-426614174000';
const eventDB={ prepare(query){return {
 params:[], bind(...args){this.params=args;return this},
 async first(){if(query.includes('FROM sessions'))return {token:'valid'};if(query.includes('MAX(key)'))return {cursor:null};return null},
 async all(){return {results:[{id:fakeEventId,value:JSON.stringify({type:'cancelled',date:'2026-11-02',time:'14:00'})}]}}
 }} };
const headers={Cookie:'session=valid'};
const baseline=await events({request:new Request('https://example.test/api/admin/events',{headers}),env:{DB:eventDB}});
const baseData=await baseline.json();
assert.equal(baseData.cursor,seed);assert.equal(baseData.events.length,0);
const next=await events({request:new Request('https://example.test/api/admin/events?after='+encodeURIComponent(seed),{headers}),env:{DB:eventDB}});
assert.equal(next.status,200);const nextData=await next.json();
assert.deepEqual(nextData.events.map(e=>e.type),['cancelled']);
assert(!JSON.stringify(nextData).includes('valid'));
console.log('PASS: first-open baseline then authorized cancellation event, no PII');
const worker=(await import('../dist/worker/index.js')).default;
const fakeCtx={waitUntil:()=>{},passThroughOnException:()=>{}};
const routed=await worker.fetch(new Request('https://example.test/api/availability?date='+date),{DB:db,ASSETS:{fetch:()=>{throw new Error('route missing')}}},fakeCtx);
assert.equal(routed.status,200);
const routedEvents=await worker.fetch(new Request('https://example.test/api/admin/events'),{DB:db,ASSETS:{fetch:()=>{throw new Error('route missing')}}},fakeCtx);
assert.equal(routedEvents.status,401);
console.log('PASS: packaged Worker routes /api/availability + /api/admin/events');
