const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path')
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8')
function recorder(old) {
  const storage={zhilu_support_diagnostics_v1:old};let resize
  const module={exports:{}}
  const wx={getStorageSync:k=>storage[k],setStorageSync:(k,v)=>storage[k]=v,getWindowInfo:()=>({windowWidth:480,windowHeight:550,screenWidth:960,screenHeight:640,pixelRatio:2.625}),getSystemInfoSync:()=>({model:'OPPO Pad Mini',brand:'OPPO',system:'Android 16',version:'8.0.78',SDKVersion:'3.11.0'}),getAccountInfoSync:()=>({miniProgram:{envVersion:'trial',version:'1.2'}}),onWindowResize:fn=>resize=fn}
  vm.runInNewContext(read('utils/support-diagnostics.js'),{module,wx,getCurrentPages:()=>[{route:'learning/course/index',options:{ticket:'secret'}}],Date})
  return {api:module.exports,storage,resize:()=>resize()}
}
test('diagnostic buffer survives restart, expires old events and strips raw errors and route queries',()=>{
  const old=[{at:Date.now()-25*3600000,event:'resize',width:123},{at:Date.now(),event:'error',error:'script',message:'secret',url:'private',route:'pages/home/index?ticket=secret'}]
  const r=recorder(old);r.api.install();r.resize()
  let report=r.api.report();assert.equal(report.samples.length,3);assert.ok(!JSON.stringify(report).includes('secret'));assert.equal(report.samples[1].width,480)
  for(let i=0;i<50;i++)r.api.record('resize')
  report=r.api.report();assert.equal(report.samples.length,40)
  const restart=recorder(r.storage.zhilu_support_diagnostics_v1);assert.equal(restart.api.report().samples.length,40)
  assert.equal(report.environment.model,'OPPO Pad Mini')
})
function help({logged=true,upload}={}) {
  let definition,login=0,calls=[]
  const wx={setClipboardData(){}}
  vm.runInNewContext(read('account/help-feedback/index.js'),{Page:v=>definition=v,wx,require(name){
    if(name.endsWith('/navigation'))return {getNavigationMetrics:()=>({statusBarHeight:20,navigationBarHeight:44,contentTop:64})}
    if(name.endsWith('/identity'))return {hasSession:()=>logged}
    if(name.endsWith('/access-gate'))return {openLogin:()=>login++}
    if(name.endsWith('/support-diagnostics'))return {record(){},report:()=>({environment:{model:'OPPO Pad Mini'}})}
    if(name.endsWith('/support-feedback'))return {createSubmission:(category,description,includeDiagnostics)=>({requestId:'same-request-id-1234',category,description,includeDiagnostics}),uploadFeedback:async data=>{calls.push(data);return upload(data,calls.length)}}
    throw new Error(name)
  }})
  const page={...definition,data:{...definition.data},setData(v){Object.assign(this.data,v)}}
  page.onLoad();return {page,calls,login:()=>login}
}
test('guests can open help, upload requires login and never fabricates success',async()=>{
  const {page,calls,login}=help({logged:false});await page.submit();assert.equal(login(),1);assert.equal(calls.length,0);assert.equal(page.data.receipt,'')
})
test('failed uploads retain exact submission for retry and successful receipt disables duplicates',async()=>{
  const {page,calls}=help({upload:async(d,n)=>{if(n===1)throw Error('offline');return 'receipt'}})
  page.descriptionChanged({detail:{value:'旋转后错位'}});await page.submit();assert.equal(page.data.receipt,'');assert.equal(page.data.description,'旋转后错位');assert.equal(page.data.error,'offline')
  await page.submit();assert.equal(calls[0],calls[1]);assert.equal(page.data.receipt,'receipt');await page.submit();assert.equal(calls.length,2)
})
test('disabling logs requires a description and concurrent clicks produce one request',async()=>{
  let release;const {page,calls}=help({upload:()=>new Promise(r=>release=r)})
  page.diagnosticsChanged({detail:{value:false}});await page.submit();assert.equal(calls.length,0)
  page.descriptionChanged({detail:{value:'课程声音消失'}});const first=page.submit();await page.submit();assert.equal(calls.length,1);assert.equal(calls[0].includeDiagnostics,false);release('receipt');await first
})
test('upload service only reports success after a valid saved receipt',async()=>{
  let response={statusCode:201,data:{}};const module={exports:{}}
  vm.runInNewContext(read('services/support-feedback.js'),{module,require:name=>name==='./identity'?{requestCourseApi:async()=>response}:{report:()=>({samples:[]})}})
  const api=module.exports;await assert.rejects(api.uploadFeedback({}));response={statusCode:201,data:{id:'11111111-1111-4111-8111-111111111111'}};assert.equal(await api.uploadFeedback({}),response.data.id)
  const item=api.createSubmission('display','',false);assert.equal(item.diagnostics,null)
})
