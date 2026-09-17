const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
function setup() {
  let definition
  const loads=[], submissions=[], changes=[], toasts=[]
  vm.runInNewContext(fs.readFileSync(require.resolve('../account/identity/index.js'),'utf8'), {
    Page: value => { definition=value },
    require: () => ({ loadCurrentIdentityVerification() { const d=deferred();loads.push(d);return d.promise }, submitCurrentGuardianIdentityVerification() { const d=deferred();submissions.push(d);return d.promise }, isAuthenticationRequired:()=>false }),
    wx:{showToast: v=>toasts.push(v),getStorageSync:()=> 'session',stopPullDownRefresh(){}},
  })
  const page={...definition,data:JSON.parse(JSON.stringify(definition.data)),setData(patch){changes.push(patch);Object.assign(this.data,patch)}}
  return {page,loads,submissions,changes,toasts}
}
test('identity status reply cannot update a hidden page or replace a newer reply',async()=>{
  const s=setup();s.page.onShow();s.page.onHide?.();const n=s.changes.length
  s.loads[0].resolve({verification:null});await new Promise(setImmediate)
  assert.equal(s.changes.length,n)
  s.page.onShow();s.loads[1].resolve({verification:{verification_status:'verified'}});await new Promise(setImmediate)
  assert.equal(s.page.data.identity.statusClass,'verified')
})
test('leaving during submission causes no stale toast or page reload; returning unlocks after settlement',async()=>{
  const s=setup();s.page.onShow();s.loads[0].resolve({verification:null});await new Promise(setImmediate)
  const pending=s.page.submitVerification();s.page.onHide?.();const n=s.changes.length
  s.submissions[0].resolve({message:'已核验'});await pending
  assert.equal(s.changes.length,n);assert.equal(s.toasts.length,0);assert.equal(s.loads.length,1)
  s.page.onShow();s.loads[1].resolve({verification:{verification_status:'verified'}});await new Promise(setImmediate)
  assert.equal(s.page.data.submitting,false)
})
test('submit failure remains visible and releases the button for retry',async()=>{
  const s=setup();s.page.onShow();s.loads[0].resolve({verification:null});await new Promise(setImmediate)
  const pending=s.page.submitVerification();s.submissions[0].reject(new Error('核验服务暂不可用'));await pending
  assert.equal(s.page.data.submitting,false);assert.equal(s.page.data.submissionError,'核验服务暂不可用')
})
test('returning before a request finishes cannot start a duplicate submission',async()=>{
  const s=setup();s.page.onShow();s.loads[0].resolve({verification:null});await new Promise(setImmediate)
  const pending=s.page.submitVerification();s.page.onHide?.();s.page.onShow();await s.page.submitVerification()
  assert.equal(s.submissions.length,1)
  s.submissions[0].reject(new Error('timeout'));await pending
  assert.equal(s.page.data.submitting,false)
})
