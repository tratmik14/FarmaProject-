import vm from 'node:vm';import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
const root=path.dirname(new URL(import.meta.url).pathname).replace(/^\/(\w:)/,'$1');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const elements=new Map();
class E{constructor(id=''){this.id=id;this.style={};this.disabled=false;this.value='';this.children=[];this.events={};this.dataset={};this.classList={add(){},remove(){},toggle(){}}}set innerHTML(v){this._html=v;for(const m of v.matchAll(/id="([^"]+)"/g))if(!elements.has(m[1]))elements.set(m[1],new E(m[1]))}get innerHTML(){return this._html||''}appendChild(e){this.children.push(e);if(e.id)elements.set(e.id,e)}addEventListener(k,f){this.events[k]=f}querySelectorAll(){return []}setAttribute(){}removeAttribute(){}getContext(){return new Proxy({},{get:()=>()=>{},set:()=>true})}click(){return this.events.click?.()} }
for(const m of html.matchAll(/id="([^"]+)"/g))elements.set(m[1],new E(m[1]));
const tabs=['dashboard','downtime','journal','deviations','about'].map(v=>{const e=new E();e.dataset.view=v;return e});
const doc={getElementById:id=>elements.get(id),createElement:()=>new E(),querySelector:sel=>{if(!elements.has(sel))elements.set(sel,new E());return elements.get(sel)},querySelectorAll:sel=>sel==='nav.tabs button'?tabs:[]};
const storage=new Map();const c=vm.createContext({document:doc,window:{addEventListener(){}},navigator:{},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v)},crypto:webcrypto,TextEncoder,Date,Math,JSON,console,Blob,URL,setInterval:()=>1,clearInterval(){},setTimeout:()=>1});
for(const f of ['data.js','journal.js','app.js','downtime.js'])vm.runInContext(fs.readFileSync(path.join(root,'js',f),'utf8'),c,{filename:f});
const run=code=>vm.runInContext(code,c);let count=0;async function test(name,f){await f();console.log('PASS',name);count++}
await test('Все разделы доступны',()=>assert.equal(tabs.length,5));
await test('Баланс времени',()=>assert.match(elements.get('balanceResult').textContent,/90 из 90/));
await test('Смена вкладки',()=>{tabs[1].click();assert.equal(tabs[1].dataset.view,'downtime')});
await test('Симуляция и эвристика',()=>{const r=run('(()=>{const s=createCycleSimulator("pump_wear");let a;for(let i=0;i<20;i++){const x=s.tick();a=assessTick(x.t,x.readings)}return a})()');assert.ok(r.worst>1.3)});
await test('Запуск, пауза, сброс',async()=>{await run('startCycle();stepCycle()');run('pauseCycle()');assert.equal(elements.get('obsMinute').textContent,'1');elements.get('resetBtn').click();assert.equal(elements.get('obsMinute').textContent,'0');assert.equal(elements.get('scenarioSelect').disabled,false)});
await test('Завершённый цикл нельзя запустить повторно',async()=>{run('startCycle()');for(let i=0;i<45;i++)await run('stepCycle()');assert.equal(elements.get('startBtn').disabled,true);assert.match(elements.get('cycleClock').textContent,/завершён/)});
await test('Новый цикл после сброса',()=>{elements.get('resetBtn').click();assert.equal(elements.get('startBtn').disabled,false)});
await test('Карточка отклонения',()=>assert.ok(run('loadDrafts().length')>0));
await test('Статус карточки',()=>{run('decide(loadDrafts()[0].id,"approved")');assert.equal(run('loadDrafts()[0].decision'),'approved')});
await test('Чистый журнал',async()=>{run('resetJournal()');await run('appendJournalEntry({test:1})');assert.equal((await run('verifyJournal()')).ok,true)});
await test('Последовательная запись при конкуренции',async()=>{run('resetJournal()');await run('Promise.all([appendJournalEntry({v:1}),appendJournalEntry({v:2}),appendJournalEntry({v:3})])');assert.equal((await run('verifyJournal()')).ok,true);assert.equal(run('loadJournal().length'),3)});
await test('Правка обнаруживается',async()=>{await run('tamperEditEntry(2)');assert.equal((await run('verifyJournal()')).ok,false)});
await test('Удаление обнаруживается',async()=>{run('resetJournal()');await run('appendJournalEntry({v:1});appendJournalEntry({v:2})');await run('journalQueue');await run('tamperDeleteEntry(1)');assert.equal((await run('verifyJournal()')).ok,false)});
await test('Обрезка хвоста обнаруживается',async()=>{run('resetJournal()');await run('appendJournalEntry({v:1})');await run('appendJournalEntry({v:2})');await run('tamperTruncateTail(1)');assert.equal((await run('verifyJournal()')).ok,false)});
await test('Повреждённая точка не считается успехом',async()=>{run('localStorage.setItem(ANCHOR_KEY,"{broken")');assert.equal((await run('verifyJournal()')).ok,false)});
await test('Все локальные ресурсы существуют',()=>{for(const m of html.matchAll(/(?:src|href)="\.\/([^"]+)"/g))assert.ok(fs.existsSync(path.join(root,m[1])),m[1])});
await test('Нет дубликатов ID',()=>{const ids=[...html.matchAll(/id="([^"]+)"/g)].map(x=>x[1]);assert.equal(new Set(ids).size,ids.length)});
console.log(`${count} checks passed. DOM adapter checks; not a real browser render.`);
