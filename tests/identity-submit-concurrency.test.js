const test = require('node:test')
const assert = require('node:assert/strict')
const identity = require('../services/identity')
const config = require('../config')
test('reopening identity verification while submitting cannot start another provider request', async () => {
  identity.resetPhoneSessionVerification()
  const requests=[]
  global.wx={getStorageSync:()=> 'session',request(options){
    if(require('./helpers/verified-phone-session')(options))return
    requests.push(options)
  }}
  const form={name:'测试姓名',idCardNumber:'11010519491231002X'}
  const pending=identity.submitCurrentGuardianIdentityVerification(form)
  await new Promise(setImmediate)
  await assert.rejects(identity.submitCurrentGuardianIdentityVerification(form),/正在处理中/)
  assert.equal(requests.length,1)
  assert.ok(requests[0].data.query.includes(config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION.id))
  requests[0].fail({errMsg:'request:fail timeout'})
  await assert.rejects(pending)
  const retry=identity.submitCurrentGuardianIdentityVerification(form)
  await new Promise(setImmediate)
  assert.equal(requests.length,2)
  requests[1].success({statusCode:200,data:{data:{result:{success:true,message:'已核验'}}}})
  assert.equal((await retry).message,'已核验')
})
