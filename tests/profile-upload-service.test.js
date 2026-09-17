const test = require('node:test')
const assert = require('node:assert/strict')
const config = require('../config/index')
const identity = require('../services/identity')

function setup({putFails=false,changeAccount=false,size=1024,readbackGrade=8,readbackSemester='上学期',readbackAccountType=''}={}) {
  identity.resetPhoneSessionVerification()
  const calls=[]; let token='profile-session'
  global.wx={getStorageSync:()=>token,removeStorageSync(){},showToast(){},reLaunch(){},
    getFileInfo: opts=>opts.success({size,digest:'0123456789abcdef0123456789abcdef'}),
    getImageInfo: opts=>opts.success({width:100,height:100,type:'png'}),
    arrayBufferToBase64: buffer=>Buffer.from(buffer).toString('base64'),
    getFileSystemManager:()=>({readFile:opts=>opts.success({data:new ArrayBuffer(10)})}),
    request(opts){
      if (require('./helpers/verified-phone-session')(opts)) return
      if(opts.method==='PUT') {calls.push('upload'); if(changeAccount)token='other-account'; return putFails?opts.fail(new Error('上传失败')):opts.success({statusCode:200})}
      const query=opts.data.query
      if(query.includes('imagePresignedUrl')) {calls.push('presign');assert.equal(opts.data.variables.acl,'PRIVATE');return opts.success({statusCode:200,data:{data:{imagePresignedUrl:{imageId:73,uploadUrl:'https://upload.example.test/avatar',uploadHeaders:{}}}}})}
      const id=query.match(/actionFlowId:\s*"([^"]+)"/)[1]
      calls.push({id,args:opts.data.variables.args})
      const result=id===config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE.id?9:{id:9,nickname:'小鹿',account_type:readbackAccountType,current_grade:readbackGrade,semester:readbackSemester,birthday:'2012-02-29',avatar_id:73,avatar:{id:73,url:'https://images.example.test/73'},profile_completed_at:'2026-09-09'}
      opts.success({statusCode:200,data:{data:{result}}})
    }
  }
  return calls
}
const form={nickname:'小鹿',grade:8,schoolStage:'初中',semester:'上学期',schoolName:'学校',textbookVersion:'人教版',regionDetail:'深圳',birthday:'2012-02-29',avatarPath:'wxfile://tmp/avatar.png'}

test('student and parent choices are sent to Zion and checked on readback',async()=>{
  for (const accountType of ['student','guardian']) {
    const calls=setup({readbackAccountType:accountType})
    const user=await identity.saveCurrentLearningProfile({...form,avatarPath:'',accountType})
    assert.equal(calls[0].args.personal_details.account_type,accountType)
    assert.equal(user.profile.account_type,accountType)
  }
  setup({readbackAccountType:'student'})
  await assert.rejects(identity.saveCurrentLearningProfile({...form,avatarPath:'',accountType:'guardian'}),/保存结果未确认/)
})

test('avatar bytes upload before profile mutation; only persistent image ID and birthday are saved',async()=>{
  const calls=setup()
  const user=await identity.saveCurrentLearningProfile(form)
  assert.deepEqual(calls.slice(0,2),['presign','upload'])
  assert.deepEqual(calls[2].args.personal_details,{birthday:'2012-02-29',avatar_id:'73'})
  assert.equal(JSON.stringify(calls[2]).includes('wxfile:'),false)
  assert.equal(user.profile.avatar_url,'https://images.example.test/73')
  assert.equal(user.profile.birthday,'2012-02-29')
})

test('failed or oversized avatar uploads never mutate the profile',async()=>{
  for(const options of [{putFails:true},{size:6*1024*1024}]) {
    const calls=setup(options)
    await assert.rejects(identity.saveCurrentLearningProfile(form))
    assert.equal(calls.some(c=>c.id===config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE.id),false)
  }
})

test('account switch during upload stops the following profile write',async()=>{
  const calls=setup({changeAccount:true})
  await assert.rejects(identity.saveCurrentLearningProfile(form),/账号已变化/)
  assert.equal(calls.some(c=>c.id===config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE.id),false)
})

test('a stale editor cannot overwrite a different account and inconsistent readback is not reported saved',async()=>{
  const calls=setup()
  await assert.rejects(identity.saveCurrentLearningProfile({...form,profileId:10}),/账号已变化/)
  assert.equal(calls.some(c=>c.id===config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE.id),false)
  setup({readbackGrade:7})
  await assert.rejects(identity.saveCurrentLearningProfile(form),/保存结果未确认/)
})
test('saving a semester is not reported successful when the readback retains the other semester',async()=>{
  setup({readbackSemester:'下学期'})
  await assert.rejects(identity.saveCurrentLearningProfile({...form,avatarPath:''}),/保存结果未确认/)
})
