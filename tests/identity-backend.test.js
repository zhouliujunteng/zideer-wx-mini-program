const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const crypto = require('node:crypto')
const bundle = fs.readFileSync(require.resolve('../../OpenMAIC-sync/integrations/zion/vendor/learning-crypto.js'), 'utf8')
const source = fs.readFileSync(require.resolve('../integrations/zion/profile/submit-identity-verification.js'), 'utf8')
// Public algorithm fixture only; providers are stubbed and never receive requests.
const card = '11010519491231002X'
function run({authRes=1,authError=0,authThrows=false,lookupThrows=false,existing=[],disabled=false,idCardNumber=card}={}) {
  const ops=[], apis=[]; let result
  const context={getArg:key=>({name:'测试姓名',idCardNumber,accountId:7})[key],setResult:v=>{result=v},
    runGql(name,query,variables){
      ops.push({name,query,variables})
      if(name==='ReadCurrentIdentityOwner') return {account_identity:disabled?[]:[{user_principal_id:42}]}
      if(name==='ReadExistingGuardianVerification') return {guardian_verification:existing}
      if(name==='UpsertGuardianVerification') return {insert_guardian_verification_one:{id:9}}
      if(name==='GrantGuardianRole') return {insert_user_role_assignment_one:{id:10}}
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
test('verification reaches both providers, stores a hash and parsed data, then grants the role',()=>{
  const s=run();assert.equal(s.result.success,true);assert.equal(s.apis.length,2)
  const saved=s.ops.find(op=>op.name==='UpsertGuardianVerification').variables.object
  assert.equal(saved.verification_status,'verified')
  assert.equal(saved.id_number_hash,crypto.createHash('sha256').update(card).digest('hex'))
  assert.equal(saved.lookup_summary.area,'北京市')
  assert.equal(JSON.stringify(saved).includes(card),false)
  assert.equal(s.ops.at(-1).name,'GrantGuardianRole')
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
  const s=run({existing:[{id:9,verification_status:'verified',id_number_hash:crypto.createHash('sha256').update(card).digest('hex')}]})
  assert.equal(s.apis.length,0);assert.equal(s.result.duplicate,true)
})
