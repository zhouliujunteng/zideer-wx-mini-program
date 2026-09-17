const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const { validBirthday } = require('../utils/profile-form')

test('birthday validation accepts leap days and rejects impossible or future birthdays', () => {
  assert.equal(validBirthday(''), true)
  assert.equal(validBirthday('2012-02-29'), true)
  for (const value of ['2013-02-29', '2020-02-30', '2030-01-01', '1899-12-31', '2010-1-01']) assert.equal(validBirthday(value, '2026-09-09'), false)
})

const source = fs.readFileSync(require.resolve('../integrations/zion/profile/save-current-profile.js'), 'utf8')
function save(args, state = {}) {
  const operations = []
  const context = {
    getArg: name => args[name],
    runGql(name, query, variables) {
      operations.push({name, query, variables})
      if (name === 'ResolveProfileOwner') return {account_identity: state.disabled ? [] : [{user_principal_id: 42}]}
      if (name === 'CheckProfileOwner') return {user_principal: state.suspended ? [] : [{id:42}]}
      if (name === 'ReadOwnBirthday') return {user_profile: state.existingProfile ? [state.existingProfile] : []}
      if (name === 'SaveOwnProfile') return {insert_user_profile_one:{id:9}}
      if (name === 'EnsureStudentBenefitAccounts') { if (state.ensureThrows) throw new Error('account insert failed'); state.ensureVars = variables; state.ensureQuery = query; return {credit:{id:91}, coin:{id:92}} }
      throw new Error('Unexpected operation')
    },
    setResult: value => { state.result = value }
  }
  vm.runInNewContext('(function(){' + source + '})()', {context})
  return operations
}
const fields = {accountId:7,nickname:'小鹿',grade:8,semester:'上学期',school_name:'学校',textbook_version:'人教版',region_detail:'深圳'}

test('declared identity is persisted without granting a verified guardian role; legacy saves preserve it', () => {
  for (const account_type of ['student', 'guardian']) {
    const ops = save({...fields, personal_details:{account_type}})
    assert.equal(ops.find(op => op.name === 'SaveOwnProfile').variables.object.account_type, account_type)
    assert.ok(ops.find(op => op.name === 'SaveOwnProfile').variables.columns.includes('account_type'))
    assert.equal(ops.some(op => /role_assignment|guardian_verification/.test(op.query)), false)
  }
  assert.equal(save(fields).find(op => op.name === 'SaveOwnProfile').variables.columns.includes('account_type'), false)
  for (const account_type of ['', 'admin', 'teacher', null]) assert.throws(() => save({...fields, personal_details:{account_type}}), /身份/)
})

test('profile save derives the owner and stage, limits conflict updates, and writes an initial empty birthday', () => {
  for (const grade of [1, 6, 7, 9, 10, 12]) {
    const ops = save({...fields,grade,school_stage:'伪造',user_principal_id:999,personal_details:{birthday:null,avatar_id:'123'}})
    const {object,columns} = ops.find(op => op.name === 'SaveOwnProfile').variables
    assert.equal(object.user_principal_id,42)
    assert.equal(object.school_stage,grade <= 6 ? '小学' : grade <= 9 ? '初中' : '高中')
    assert.equal(object.birthday,null)
    assert.equal(object.avatar_id,'123')
    assert.equal(columns.includes('status'),false)
    assert.equal(columns.includes('real_name'),false)
    assert.equal(columns.includes('user_principal_id'),false)
    assert.equal(ops[0].query.includes('disabled_at:{_is_null:true}'),true)
  }
  assert.equal(save(fields).find(op => op.name === 'SaveOwnProfile').variables.columns.includes('birthday'),false)
  assert.equal(save(fields).find(op => op.name === 'SaveOwnProfile').variables.columns.includes('avatar_id'),false)
})

test('birthday can only be changed once after its first setting; clearing an existing birthday is ignored', () => {
  // 首次修改：写入新生日并消耗唯一机会
  const changed = save({...fields, personal_details:{birthday:'2011-05-20'}}, {existingProfile:{birthday:'2012-06-15', birthday_change_used:false}}).find(op => op.name === 'SaveOwnProfile').variables
  assert.equal(changed.object.birthday,'2011-05-20')
  assert.equal(changed.object.birthday_change_used,true)
  assert.equal(changed.columns.includes('birthday_change_used'),true)
  // 机会已用：再次修改被拒绝
  assert.throws(() => save({...fields, personal_details:{birthday:'2011-05-21'}}, {existingProfile:{birthday:'2011-05-20', birthday_change_used:true}}), /修改机会已用完/)
  // 重复提交相同生日：不消耗机会
  const same = save({...fields, personal_details:{birthday:'2012-06-15'}}, {existingProfile:{birthday:'2012-06-15', birthday_change_used:false}}).find(op => op.name === 'SaveOwnProfile').variables
  assert.equal(same.object.birthday,'2012-06-15')
  assert.equal(same.object.birthday_change_used,undefined)
  assert.equal(same.columns.includes('birthday_change_used'),false)
  // 已设置的生日不接受清空（空值被忽略，不产生 birthday 更新）
  const cleared = save({...fields, personal_details:{birthday:null}}, {existingProfile:{birthday:'2012-06-15', birthday_change_used:false}}).find(op => op.name === 'SaveOwnProfile').variables
  assert.equal(cleared.object.birthday,undefined)
  assert.equal(cleared.columns.includes('birthday'),false)
})

test('gender is validated and persisted alongside personal details', () => {
  for (const gender of ['male', 'female']) {
    const {object,columns} = save({...fields, personal_details:{gender}}).find(op => op.name === 'SaveOwnProfile').variables
    assert.equal(object.gender,gender)
    assert.equal(columns.includes('gender'),true)
  }
  const empty = save({...fields, personal_details:{gender:null}}).find(op => op.name === 'SaveOwnProfile').variables
  assert.equal(empty.object.gender,null)
  for (const gender of ['boy', '未知', 1]) assert.throws(() => save({...fields, personal_details:{gender}}), /性别/)
})

test('profile save rejects disabled accounts, invalid dates, grades and injected detail fields before writing', () => {
  assert.throws(() => save({...fields,accountId:null}))
  assert.throws(() => save(fields,{disabled:true}))
  assert.throws(() => save(fields,{suspended:true}))
  for (const grade of [13, -1, 1.5]) assert.throws(() => save({...fields,grade}))
  // grade = 0 表示「都不是」：学段与学期允许为空
  const none = save({...fields, grade: 0, semester: ''}).find(op => op.name === 'SaveOwnProfile').variables
  // 「都不是」时教材允许为空
  const noneNoTextbook = save({...fields, grade: 0, semester: '', textbook_version: ''}).find(op => op.name === 'SaveOwnProfile').variables
  assert.equal(noneNoTextbook.object.textbook_version, '')
  // 常规年级教材仍必填
  assert.throws(() => save({...fields, textbook_version: ''}), /教材|完整/)
  assert.equal(none.object.current_grade, 0)
  assert.equal(none.object.school_stage, '')
  assert.equal(none.object.semester, '')
  for (const semester of ['', '未知']) assert.throws(() => save({...fields,semester}), /学期|完整/)
  for (const personal_details of [{birthday:'2013-02-29'},{birthday:'2030-01-01'},{avatar_id:'wxfile://tmp/a.jpg'},{user_principal_id:999}]) assert.throws(() => save({...fields,personal_details}))
})
test('profile save normalizes legacy semester aliases to the current form values', () => {
  assert.equal(save({...fields,semester:'second'}).find(op => op.name === 'SaveOwnProfile').variables.object.semester,'下学期')
  assert.equal(save({...fields,semester:'秋季'}).find(op => op.name === 'SaveOwnProfile').variables.object.semester,'上学期')
})

test('contacts return only masked own-account values', () => {
  const code = fs.readFileSync(require.resolve('../integrations/zion/profile/read-current-contacts.js'),'utf8')
  let value; const requests = []
  const context = {getArg: () => 7, setResult: result => { value=result }, runGql(name,query,variables) {
    requests.push({name,variables})
    if(name==='FindCurrentPrincipal') return {account_identity:[{user_principal_id:42}]}
    if(name==='ReadCurrentLoginIdentities') return {user_principal:[{id:42}]}
    return {account:[{fz_phone_number:'13812345678',fz_email:'student@example.com'}]}
  }}
  vm.runInNewContext('(function(){' + code + '})()',{context})
  assert.equal(value.principal.contacts.phone,'138****5678')
  assert.equal(value.principal.contacts.email,'s***@example.com')
  assert.equal(requests.at(-1).variables.id,7)
})

test('saving a completed profile idempotently creates zero-balance benefit accounts', () => {
  const state = {}
  const ops = save(fields, state)
  const ensure = ops.find(op => op.name === 'EnsureStudentBenefitAccounts')
  assert.ok(ensure, 'account ensure should run after profile save')
  assert.equal(ensure.variables.profileId, 9)
  assert.ok(ensure.query.includes('insert_learner_credit_account_one') && ensure.query.includes('insert_coin_account_one'))
  assert.ok(ensure.query.includes('on_conflict:{constraint:learner_credit_account_learner_profile_id_key,update_columns:[]}'))
  assert.ok(ensure.query.includes('on_conflict:{constraint:coin_account_learner_profile_id_key,update_columns:[]}'))
  assert.ok(ensure.query.includes('status:\"active\"'))
})

test('profile save still succeeds when benefit account creation fails', () => {
  const state = {ensureThrows: true}
  const ops = save(fields, state)
  assert.ok(ops.find(op => op.name === 'SaveOwnProfile'))
  assert.equal(state.result, 9)
})
