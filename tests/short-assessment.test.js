const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path')
function fixture(call){let definition;const modals=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../assessment/short/index.js'),'utf8'),{Page:p=>{definition=p},require:()=>({call,reportView:r=>r}),wx:{showModal:m=>modals.push(m),navigateTo(){}}});const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(v){Object.assign(this.data,v)}};page.onLoad({});page.visible=true;return{page,modals};}
const attempt={id:1,revision:0,status:'draft',answeredCount:1,current:{id:11,type:'numeric'},scope:{},report:null};
test('answer submission is locked and late response after hide cannot overwrite resumed state',async()=>{
  let release,calls=0;const {page}=fixture(()=>{calls++;return new Promise(r=>release=r)});page.data.attempt=attempt;page.data.answer='5';const pending=page.next({currentTarget:{dataset:{}}});await page.next({currentTarget:{dataset:{}}});assert.equal(calls,1);page.onHide();release({attempt:{...attempt,id:2}});await pending;assert.equal(page.data.attempt.id,1);assert.equal(page.data.busy,false);
});
test('a submit confirmation cannot finalize after the page is hidden',async()=>{
  let calls=0;const{page,modals}=fixture(async()=>{calls++});page.data.attempt=attempt;page.submit();page.onHide();modals[0].success({confirm:true});assert.equal(calls,0);
});
test('a bank or scope failure remains an error and never shows a successful attempt',async()=>{
  const {page}=fixture(async()=>{throw Object.assign(Error('题库未就绪'),{code:'bank_not_ready'})});await page.start({currentTarget:{dataset:{id:1}}});assert.equal(page.data.attempt,null);assert.equal(page.data.error,'题库未就绪');assert.equal(page.data.grantRequired,false);
});
