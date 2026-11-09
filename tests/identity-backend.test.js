const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const crypto = require('node:crypto')
const bundle = fs.readFileSync(require.resolve('../../OpenMAIC-sync/integrations/zion/vendor/learning-crypto.js'), 'utf8')
const source = fs.readFileSync(require.resolve('../integrations/zion/profile/verified-identity.js'), 'utf8') + '\n' + fs.readFileSync(require.resolve('../integrations/zion/profile/submit-identity-verification.js'), 'utf8')
// Public algorithm fixture only; providers are stubbed and never receive requests.
const card = '11010519491231002X'
function run({authRes=1,authError=0,authThrows=false,lookupThrows=false,existing=[],disabled=false,idCardNumber=card,legacyUpdated=1}={}) {
  const ops=[], apis=[]; let result
  const context={getArg:key=>({name:'测试姓名',idCardNumber,accountId:7})[key],setResult:v=>{result=v},
    runGql(name,query,variables){
      ops.push({name,query,variables})
      if(name==='ReadCurrentIdentityOwner') return {account_identity:disabled?[]:[{user_principal_id:42}]}
      if(name==='ReadExistingGuardianVerification') return {guardian_verification:existing}
      if(name==='UpsertGuardianVerification') return {insert_guardian_verification_one:{id:9}}
      if(name==='FillProfileFromVerification') return {update_user_profile:{affected_rows:1}}
      if(name==='GrantGuardianRole') return {insert_user_role_assignment_one:{id:10}}
      if(name==='CompleteLegacyVerification') return {update_guardian_verification:{affected_rows:legacyUpdated}}
      throw Error('Unexpected operation')
    },callThirdPartyApi(id){
      apis.push(id)
      if(id==='mto8sww9') {if(authThrows)throw Error('offline');return {code:200,data:JSON.stringify({error_code:authError,result:{res:authRes,orderid:'mock-order'}})}}
      if(lookupThrows)throw Error('offline')
      return {code:200,data:{resultcode:'200',error_code:0,result:{area:'北京市',sex:'女',birthday:'1949年12月31日'}}}
    }}
  vm.runInNewContext(bundle+'\n(function(){'+source+'})()', {context}, {timeout:500})
  return {ops,apis,result}
}
test('SHA-256 terminates for 18 characters and matches standard ASCII and Unicode vectors',()=>{
  const sandbox={};vm.runInNewContext(bundle,sandbox,{timeout:500})
  for(const value of ['', '0'.repeat(18), '核验成功'])assert.equal(sandbox.OpenMaicLearningCrypto.sha256(value),crypto.createHash('sha256').update(value).digest('hex'))
})
// 2026-09-29 起普通实名不再刷脸：姓名与身份证号一致即完成实名、写资料、满 22 周岁授予家长角色（刷脸只在申请推广伙伴时做）
const hash=crypto.createHash('sha256').update(card).digest('hex')
test('verification reaches both providers, stores a hash and parsed data, and completes real-name verification',()=>{
  const s=run();assert.equal(s.result.success,true);assert.equal(s.apis.length,2)
  assert.equal(s.result.verify,null)
  const saved=s.ops.find(op=>op.name==='UpsertGuardianVerification').variables.object
  assert.equal(saved.verification_status,'verified')
  assert.ok(saved.verified_at)
  assert.equal(saved.id_number_hash,hash)
  assert.equal(saved.lookup_summary.area,'北京市')
  assert.equal(JSON.stringify(saved).includes(card),false)
  assert.deepEqual(s.ops.map(op=>op.name).slice(-2),['FillProfileFromVerification','GrantGuardianRole'])
})
test('a record left waiting for the old face check completes with the same card without paying again',()=>{
  const s=run({existing:[{id:9,verification_status:'pending_liveness',id_number_hash:hash,lookup_summary:{province:'北京市',city:null}}]})
  assert.equal(s.apis.length,0);assert.equal(s.result.success,true);assert.equal(s.result.verify,null)
  const done=s.ops.find(op=>op.name==='CompleteLegacyVerification')
  assert.match(done.query,/verification_status: \{_eq: "pending_liveness"\}, id_number_hash: \{_eq: \$hash\}/)
  assert.deepEqual({...s.ops.find(op=>op.name==='FillProfileFromVerification').variables.patch},{birthday:'1949-12-31',gender:'female',household_region:'北京市'})
  // 换了一张身份证、或状态刚被改掉：照常重新核对
  assert.equal(run({existing:[{id:9,verification_status:'pending_liveness',id_number_hash:'other'}]}).apis.length,2)
  assert.equal(run({existing:[{id:9,verification_status:'pending_liveness',id_number_hash:hash}],legacyUpdated:0}).apis.length,2)
})
test('a mismatch is recorded without granting access or calling the lookup API',()=>{
  const s=run({authRes:2});assert.equal(s.result.success,false);assert.equal(s.apis.length,1)
  assert.equal(s.ops.at(-1).variables.object.verification_status,'rejected')
})
test('provider outage is not recorded as an identity mismatch; lookup outage retains verified status',()=>{
  for(const options of [{authThrows:true},{authError:10001}]){
    const s=run(options);assert.equal(s.result.success,false)
    assert.equal(s.ops.some(op=>op.name==='UpsertGuardianVerification'),false)
  }
  const s=run({lookupThrows:true});assert.equal(s.result.success,true)
  assert.equal(s.ops.find(op=>op.name==='UpsertGuardianVerification').variables.object.failure_code,'lookup_unavailable')
})
test('invalid or disabled accounts and already verified identities make no external calls',()=>{
  for(const options of [{idCardNumber:'0'.repeat(18)},{disabled:true}])assert.equal(run(options).apis.length,0)
  const s=run({existing:[{id:9,verification_status:'verified',legal_name:'测试姓名',id_number_hash:hash}]})
  assert.equal(s.apis.length,0);assert.equal(s.result.duplicate,true);assert.equal(s.result.success,true)
})
test('a verified account cannot re-verify with a different name or ID number',()=>{
  for(const existing of [{id:9,verification_status:'verified',legal_name:'测试姓名',id_number_hash:'other'},{id:9,verification_status:'verified',legal_name:'别人',id_number_hash:hash}]){
    const s=run({existing:[existing]})
    assert.equal(s.apis.length,0);assert.equal(s.result.success,false);assert.equal(s.result.verify,'identity_mismatch')
    assert.equal(s.ops.some(op=>op.name==='UpsertGuardianVerification'),false)
  }
})
