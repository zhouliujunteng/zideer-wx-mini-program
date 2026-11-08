const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// 家长年龄门槛（2026-09-25 用户规则）：学生切换为家长要先实名认证；实名后满 22 周岁才算家长，
// 才能切换为家长、绑定学生。首次建档直接选家长不查实名，到绑定学生时再核验。
function yearsAgo(years, dayOffset = 0) {
  const today = new Date(Date.now() + 8 * 3600000)
  const date = new Date(Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate() + dayOffset))
  return date.toISOString().slice(0, 10)
}

const verifiedIdentitySource = fs.readFileSync(require.resolve('../integrations/zion/profile/verified-identity.js'), 'utf8')
const saveSource = verifiedIdentitySource + '\n' + fs.readFileSync(require.resolve('../integrations/zion/profile/save-current-profile.js'), 'utf8')
function save(args, state = {}) {
  const operations = []
  const context = {
    getArg: name => args[name],
    runGql(name, query, variables) {
      operations.push({ name, query, variables })
      if (name === 'ResolveProfileOwner') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'CheckProfileOwner') return { user_principal: [{ id: 42 }] }
      if (name === 'ReadOwnVerifiedIdentity') return { guardian_verification: [] }
      if (name === 'ReadOwnRoleSwitchState') return { user_profile: state.profile ? [state.profile] : [], guardian_verification: state.verification ? [state.verification] : [] }
      if (name === 'SaveOwnProfile') return { insert_user_profile_one: { id: 9 } }
      if (name === 'EnsureStudentBenefitAccounts') return {}
      throw new Error('Unexpected operation ' + name)
    },
    setResult: value => { state.result = value }
  }
  vm.runInNewContext('(function(){' + saveSource + '})()', { context })
  return operations
}
// 切换为家长时保留学生的学校、年级、教材（2026-09-25 用户规则：改回学生直接沿用）
const keepStudentFields = { accountId: 7, nickname: '小鹿', grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版', region_detail: '深圳', personal_details: { account_type: 'guardian' } }
const student = { account_type: 'student', profile_completed_at: '2026-09-01T00:00:00Z' }

test('a completed student cannot switch to guardian before real-name verification', () => {
  assert.throws(() => save(keepStudentFields, { profile: student }), /^Error: GUARDIAN_VERIFICATION_REQUIRED/)
  // 早期建档没记身份的也按学生处理
  assert.throws(() => save(keepStudentFields, { profile: { account_type: null, profile_completed_at: '2026-09-01' } }), /GUARDIAN_VERIFICATION_REQUIRED/)
})

test('switching to guardian needs the verified birth date to be at least 22 years ago', () => {
  assert.throws(() => save(keepStudentFields, { profile: student, verification: { lookup_summary: { id_birth_date: yearsAgo(22, 1) } } }), /GUARDIAN_UNDERAGE/)
  assert.throws(() => save(keepStudentFields, { profile: student, verification: { lookup_summary: { id_birth_date: yearsAgo(19) } } }), /GUARDIAN_UNDERAGE/)
  assert.throws(() => save(keepStudentFields, { profile: student, verification: { lookup_summary: null } }), /GUARDIAN_AGE_UNKNOWN/)
  const state = {}
  const ops = save(keepStudentFields, { ...state, profile: student, verification: { lookup_summary: { id_birth_date: yearsAgo(22) } } })
  const object = ops.find(op => op.name === 'SaveOwnProfile').variables.object
  assert.equal(object.account_type, 'guardian')
  // 学生资料原样保存，不清空
  assert.equal(object.current_grade, 8)
  assert.equal(object.school_name, '实验中学')
  assert.equal(object.textbook_version, '人教版')
  // 早期实名记录只有资料解析的生日（1990年01月01日 这种写法）
  const [year, month, day] = yearsAgo(30).split('-')
  assert.ok(save(keepStudentFields, { profile: student, verification: { lookup_summary: JSON.stringify({ birthday: `${year}年${month}月${day}日` }) } }).find(op => op.name === 'SaveOwnProfile'))
})

test('registering as guardian and editing a guardian profile never ask for real-name verification', () => {
  const guardianForm = { accountId: 7, nickname: '鹿妈妈', grade: 0, semester: '', school_name: '', textbook_version: '', region_detail: '深圳', personal_details: { account_type: 'guardian' } }
  // 首次建档：还没有档案，或档案未完成
  assert.ok(save(guardianForm, {}).find(op => op.name === 'SaveOwnProfile'))
  assert.ok(save(guardianForm, { profile: { account_type: null, profile_completed_at: null } }).find(op => op.name === 'SaveOwnProfile'))
  // 已是家长，编辑资料
  assert.ok(save(guardianForm, { profile: { account_type: 'guardian', profile_completed_at: '2026-09-01' } }).find(op => op.name === 'SaveOwnProfile'))
  // 家长改回学生不需要实名
  const back = { ...keepStudentFields, personal_details: { account_type: 'student' } }
  assert.equal(save(back, {}).some(op => op.name === 'ReadOwnRoleSwitchState'), false)
})

const bindSource = fs.readFileSync(require.resolve('../integrations/zion/profile/bind-guardian-student.js'), 'utf8')
function bind(state = {}) {
  const ops = []
  let result
  const context = {
    getArg: key => ({ accountId: 7, code: '12345678' })[key],
    setResult: value => { result = value },
    runGql(name, query, variables) {
      ops.push({ name, query, variables })
      if (name === 'GetBindingGuardian') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'GetBindingState') return { student_binding_code: [{ id: 3, status: 'active', expires_at: new Date(Date.now() + 3600000).toISOString(), student_profile_id: 11 }], guardian_verification: state.verification ? [state.verification] : [] }
      if (name === 'VerifyBindingAccess') return { user_profile: [{ id: 5 }], guardian_student_relation: [] }
      if (name === 'ConsumeBindingCode') return { update_student_binding_code: { affected_rows: 1 } }
      if (name === 'BindGuardianStudent') return { insert_guardian_student_relation_one: { id: 99, status: 'active' } }
      // 服务商（2026-10-11）：state.provider = { id, child_limit }，state.bound = 名下已有的有效关系数
      if (name === 'BindingServiceProvider') return { service_provider: state.provider ? [state.provider] : [] }
      if (name === 'ProviderBoundChildren') return { guardian_student_relation: Array.from({ length: state.bound || 0 }, (_, i) => ({ id: i + 1 })) }
      throw new Error('Unexpected operation ' + name)
    }
  }
  vm.runInNewContext('(function(){' + bindSource + '})()', { context })
  return { ops, result }
}

test('binding a student checks the guardian age before consuming the code', () => {
  assert.equal(bind({}).result.status, 'guardian_verification_required')
  const young = bind({ verification: { id: 1, lookup_summary: { id_birth_date: yearsAgo(21) } } })
  assert.deepEqual({ ...young.result }, { status: 'guardian_underage', minAge: 22 })
  assert.equal(young.ops.some(op => op.name === 'ConsumeBindingCode'), false)
  assert.equal(bind({ verification: { id: 1, lookup_summary: {} } }).result.status, 'guardian_age_unknown')
  const adult = bind({ verification: { id: 1, lookup_summary: { id_birth_date: yearsAgo(35) } } })
  assert.equal(adult.result.status, 'bound')
  assert.match(adult.ops.find(op => op.name === 'GetBindingState').query, /lookup_summary/)
})

test('a service provider binds without real-name checks, up to the limit set in the admin', () => {
  const ok = bind({ provider: { id: 7, child_limit: 3 }, bound: 2 })
  assert.equal(ok.result.status, 'bound')
  const insert = ok.ops.find(op => op.name === 'BindGuardianStudent').variables.object
  assert.deepEqual({ ...insert.verification_snapshot, verified_at: 'x' }, { source: 'service_provider', service_provider_id: 7, verified_at: 'x' })
  const full = bind({ provider: { id: 7, child_limit: 3 }, bound: 3 })
  assert.deepEqual({ ...full.result }, { status: 'provider_limit_reached', limit: 3, used: 3 })
  assert.equal(full.ops.some(op => op.name === 'ConsumeBindingCode'), false, '到上限不消耗绑定码')
  // 不是服务商：照旧要实名
  assert.equal(bind({ bound: 0 }).result.status, 'guardian_verification_required')
})

test('the binding code hash stays byte-identical to the live flow', () => {
  // 绑定码由另一个动作流按同一个 sha256 生成，这里不能改动
  const live = bindSource.slice(bindSource.indexOf('function sha256'))
  assert.match(live, /^function sha256\(a\)\{function r\(v,n\)/)
  assert.ok(live.includes("a+='\\x80'"))
})

const cryptoBundle = fs.readFileSync(require.resolve('../../OpenMAIC-sync/integrations/zion/vendor/learning-crypto.js'), 'utf8')
const identitySource = verifiedIdentitySource + '\n' + fs.readFileSync(require.resolve('../integrations/zion/profile/submit-identity-verification.js'), 'utf8')
function checkDigit(body) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const sum = body.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  return body + '10X98765432'[sum % 11]
}
function verify(card, { lookupThrows = false } = {}) {
  const ops = []
  let result
  const context = {
    getArg: key => ({ name: '测试姓名', idCardNumber: card, accountId: 7 })[key],
    setResult: value => { result = value },
    runGql(name, query, variables) {
      ops.push({ name, variables })
      if (name === 'ReadCurrentIdentityOwner') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'ReadExistingGuardianVerification') return { guardian_verification: [] }
      if (name === 'UpsertGuardianVerification') return { insert_guardian_verification_one: { id: 9 } }
      if (name === 'FillProfileFromVerification') return { update_user_profile: { affected_rows: 1 } }
      if (name === 'GrantGuardianRole') return { insert_user_role_assignment_one: { id: 10 } }
      throw new Error('Unexpected operation ' + name)
    },
    callThirdPartyApi(id) {
      if (id === 'mto8sww9') return { code: 200, data: JSON.stringify({ error_code: 0, result: { res: 1, orderid: 'mock' } }) }
      if (lookupThrows) throw new Error('offline')
      return { code: 200, data: { resultcode: '200', error_code: 0, result: { area: '北京市', sex: '女', birthday: '2000年01月01日' } } }
    }
  }
  vm.runInNewContext(cryptoBundle + '\n(function(){' + identitySource + '})()', { context }, { timeout: 500 })
  return { ops, result }
}

test('real-name verification stores the birth date from the ID card and grants the guardian role from 22', () => {
  const adultBirth = yearsAgo(40).replace(/-/g, '')
  const adult = verify(checkDigit('110105' + adultBirth + '002'), { lookupThrows: true })
  const saved = adult.ops.find(op => op.name === 'UpsertGuardianVerification').variables.object
  // 资料解析接口挂了也照样记下身份证上的出生日期
  assert.equal(saved.lookup_summary.id_birth_date, yearsAgo(40))
  assert.equal(saved.verification_status, 'verified')
  assert.equal(adult.result.success, true)
  // 2026-09-29 起姓名与身份证号一致即完成实名，满 22 周岁当场授予家长角色
  assert.equal(adult.ops.some(op => op.name === 'GrantGuardianRole'), true)
  const young = verify(checkDigit('110105' + yearsAgo(21).replace(/-/g, '') + '002'))
  assert.equal(young.result.success, true)
  assert.equal(young.ops.some(op => op.name === 'GrantGuardianRole'), false)
})
