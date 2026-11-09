const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

// 实名认证后锁定个人资料（2026-09-26 用户规则）：生日、性别、户籍地以身份证为准，填好后不能再改；
// 所在城市是用户自己填的，与户籍地分开。三个动作流上线时都把 verified-identity.js 拼在前面。
const read = (path) => fs.readFileSync(require.resolve(path), 'utf8')
const helper = read('../integrations/zion/profile/verified-identity.js')
const identityOf = (record) => {
  const sandbox = { record }
  vm.runInNewContext(helper + '\nresult = verifiedIdentity(record)', sandbox)
  return sandbox.result
}

test('locked values come from the ID number first and fall back to the older lookup fields', () => {
  // 新记录：身份证号推出的出生日期与性别，加上资料解析的发证地
  assert.deepEqual({ ...identityOf({ id_number_tail: '0023', lookup_summary: { id_birth_date: '1988-04-09', id_gender: 'female', province: '浙江省', city: '温州市', sex: '男' } }) },
    { birthday: '1988-04-09', gender: 'female', household_region: '浙江省 温州市' })
  // 早期记录：没有 id_gender / id_birth_date，性别从尾号第 3 位推出（后 4 位里的第 17 位），生日用资料解析的写法
  assert.deepEqual({ ...identityOf({ id_number_tail: '0015', lookup_summary: JSON.stringify({ birthday: '1990年1月2日', province: null, city: '北京市', sex: '女' }) }) },
    { birthday: '1990-01-02', gender: 'male', household_region: '北京市' })
  assert.equal(identityOf({ id_number_tail: '002X', lookup_summary: {} }).gender, 'female')
  // 尾号不全时才用资料解析的性别；什么都没有就不锁
  assert.equal(identityOf({ id_number_tail: '', lookup_summary: { sex: '女' } }).gender, 'female')
  assert.deepEqual({ ...identityOf({ lookup_summary: null }) }, { birthday: '', gender: '', household_region: '' })
  assert.equal(identityOf(null), null)
  // 直辖市省、市同名只留一个
  assert.equal(identityOf({ lookup_summary: { province: '上海市', city: '上海市' } }).household_region, '上海市')
})

test('the shared helper keeps Chinese out of code so the ASCII-only deploy check covers it', () => {
  const code = helper.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
  assert.doesNotMatch(code, /[^\x00-\x7f]/)
})

function readProfile({ profile, verification }) {
  let result
  const queries = []
  const context = {
    getArg: () => 7,
    setResult: (value) => { result = value },
    runGql(name, query) {
      queries.push({ name, query })
      if (name === 'ReadCurrentProfileIdentity') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'ReadCurrentLearningProfile') return { user_profile: profile ? [{ ...profile }] : [], guardian_verification: verification ? [verification] : [] }
      if (name === 'ReadProfilePublicId') return { user_principal: [{ public_id: '123456' }] }
      throw new Error('Unexpected operation ' + name)
    }
  }
  vm.runInNewContext(helper + '\n(function(){' + read('../integrations/zion/profile/read-current-profile.js') + '})()', { context })
  return { result, queries }
}

test('reading the profile returns the verified values with lock flags, in the same query', () => {
  const stored = { id: 9, nickname: '鹿妈妈', gender: null, birthday: '1990-01-01', region_detail: '杭州市', household_region: null }
  const verified = readProfile({ profile: stored, verification: { id_number_tail: '0023', lookup_summary: { id_birth_date: '1988-04-09', id_gender: 'female', province: '浙江省', city: '温州市' } } })
  assert.equal(verified.result.birthday, '1988-04-09')
  assert.equal(verified.result.gender, 'female')
  assert.equal(verified.result.household_region, '浙江省 温州市')
  // 所在城市是用户自己填的，不跟身份证走
  assert.equal(verified.result.region_detail, '杭州市')
  assert.deepEqual([verified.result.birthday_locked, verified.result.gender_locked, verified.result.household_region_locked], [true, true, true])
  const query = verified.queries.find((item) => item.name === 'ReadCurrentLearningProfile').query
  assert.match(query, /household_region/)
  assert.match(query, /guardian_verification\(where: \{ guardian_principal_id: \{ _eq: \$principalId \}, verification_status: \{ _eq: "verified" \} \}/)

  // 发证地没解析出来：户籍地不锁，保留用户自己填的
  const noPlace = readProfile({ profile: { ...stored, household_region: '温州' }, verification: { id_number_tail: '0023', lookup_summary: { id_birth_date: '1988-04-09' } } })
  assert.equal(noPlace.result.household_region, '温州')
  assert.equal(noPlace.result.household_region_locked, false)

  const unverified = readProfile({ profile: stored })
  assert.equal(unverified.result.birthday, '1990-01-01')
  assert.deepEqual([unverified.result.birthday_locked, unverified.result.gender_locked, unverified.result.household_region_locked], [false, false, false])
  assert.equal(readProfile({}).result, null)
})

const saveSource = helper + '\n' + read('../integrations/zion/profile/save-current-profile.js')
function save(args, state = {}) {
  const operations = []
  const context = {
    getArg: (name) => args[name],
    runGql(name, query, variables) {
      operations.push({ name, query, variables })
      if (name === 'ResolveProfileOwner') return { account_identity: [{ user_principal_id: 42 }] }
      if (name === 'CheckProfileOwner') return { user_principal: [{ id: 42 }] }
      if (name === 'ReadOwnVerifiedIdentity') return { guardian_verification: state.verified ? [state.verified] : [] }
      if (name === 'ReadOwnAccountType') return { user_profile: state.accountType ? [{ account_type: state.accountType }] : [] }
      if (name === 'ReadOwnRoleSwitchState') return { user_profile: [], guardian_verification: [] }
      if (name === 'ReadOwnBirthday') return { user_profile: state.existing ? [state.existing] : [] }
      if (name === 'SaveOwnProfile') return { insert_user_profile_one: { id: 9 } }
      if (name === 'EnsureStudentBenefitAccounts') return {}
      throw new Error('Unexpected operation ' + name)
    },
    setResult() {}
  }
  vm.runInNewContext('(function(){' + saveSource + '})()', { context })
  return operations.find((op) => op.name === 'SaveOwnProfile').variables
}
const guardian = { accountId: 7, nickname: '鹿妈妈', grade: 0, semester: '', school_name: '', textbook_version: '', region_detail: '' }
const student = { accountId: 7, nickname: '小鹿', grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版', region_detail: '浙江省 杭州市' }
const verified = { id_number_tail: '0023', lookup_summary: { id_birth_date: '1988-04-09', id_gender: 'female', province: '浙江省', city: '温州市' } }

test('a verified profile always saves the ID values, even when the page did not send them', () => {
  const { object, columns } = save({ ...guardian, personal_details: { account_type: 'guardian' } }, { verified })
  assert.equal(object.birthday, '1988-04-09')
  assert.equal(object.gender, 'female')
  assert.equal(object.household_region, '浙江省 温州市')
  for (const key of ['birthday', 'gender', 'household_region']) assert.ok(columns.includes(key))
  // 按身份证写入不消耗「生日只能改一次」的机会
  assert.equal(columns.includes('birthday_change_used'), false)
  const same = save({ ...guardian, personal_details: { birthday: '1988-04-09', gender: 'female', household_region: '浙江省 温州市' } }, { verified, accountType: 'guardian', existing: { birthday: '1990-01-01', birthday_change_used: true } })
  assert.equal(same.object.birthday, '1988-04-09')
  assert.equal(same.object.birthday_change_used, undefined)
})

test('a verified profile rejects a different birthday, gender or household region', () => {
  const state = { verified, accountType: 'guardian' }
  assert.throws(() => save({ ...guardian, personal_details: { birthday: '1990-01-01' } }, state), /生日已按实名认证信息填写/)
  assert.throws(() => save({ ...guardian, personal_details: { gender: 'male' } }, state), /性别已按实名认证信息填写/)
  assert.throws(() => save({ ...guardian, personal_details: { household_region: '江苏省 南京市' } }, state), /户籍地已按实名认证信息填写/)
  // 发证地没解析出来：户籍地照常由用户填写
  const noPlace = { ...verified, lookup_summary: { id_birth_date: '1988-04-09' } }
  const { object } = save({ ...guardian, personal_details: { household_region: '温州' } }, { verified: noPlace, accountType: 'guardian' })
  assert.equal(object.household_region, '温州')
  assert.equal(object.gender, 'female')
})

test('before verification gender and household region are optional and the guardian city is optional', () => {
  const { object, columns } = save({ ...guardian, personal_details: { account_type: 'guardian', household_region: ' 浙江省 温州市 ', gender: 'male' } })
  assert.equal(object.household_region, '浙江省 温州市')
  assert.equal(object.gender, 'male')
  assert.equal(object.region_detail, '')
  assert.equal(columns.includes('birthday'), false)
  // 学生的所在城市仍必填
  assert.throws(() => save({ ...student, region_detail: '' }), /完整/)
  assert.equal(save(student).object.region_detail, '浙江省 杭州市')
  assert.throws(() => save({ ...student, personal_details: { household_region: 'x'.repeat(41) } }), /长度/)
  // 没提交户籍地就不动它
  assert.equal(save(student).columns.includes('household_region'), false)
})

// 实名通过（姓名与身份证号一致，2026-09-29 起不再刷脸）就把生日、性别、户籍地写进资料并锁定；核对不通过不动资料
const submitSource = read('../../OpenMAIC-sync/integrations/zion/vendor/learning-crypto.js') + '\n' + helper + '\n(function(){' + read('../integrations/zion/profile/submit-identity-verification.js') + '})()'
function checkDigit(body) {
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const sum = body.split('').reduce((total, digit, index) => total + Number(digit) * weights[index], 0)
  return body + '10X98765432'[sum % 11]
}

test('passing the name and ID check fills birthday, gender and household region; a mismatch touches nothing', () => {
  for (const res of [1, 2]) {
    const ops = []
    let result
    const context = {
      getArg: (key) => ({ name: '测试姓名', idCardNumber: checkDigit('330302' + '19880409' + '013'), accountId: 7 })[key],
      setResult: (value) => { result = value },
      runGql(name, query, variables) {
        ops.push({ name, variables })
        if (name === 'ReadCurrentIdentityOwner') return { account_identity: [{ user_principal_id: 42 }] }
        if (name === 'ReadExistingGuardianVerification') return { guardian_verification: [] }
        if (name === 'UpsertGuardianVerification') return { insert_guardian_verification_one: { id: 9 } }
        if (name === 'FillProfileFromVerification') return { update_user_profile: { affected_rows: 1 } }
        if (name === 'GrantGuardianRole') return { insert_user_role_assignment_one: { id: 10 } }
        throw new Error('Unexpected operation ' + name)
      },
      callThirdPartyApi: (id) => id === 'mto8sww9'
        ? { code: 200, data: JSON.stringify({ error_code: 0, result: { res, orderid: 'mock' } }) }
        : { code: 200, data: { resultcode: '200', error_code: 0, result: { area: '浙江省温州市鹿城区', sex: '\u7537', birthday: '1988年04月09日' } } }
    }
    vm.runInNewContext(submitSource, { context }, { timeout: 500 })
    const saved = ops.find((op) => op.name === 'UpsertGuardianVerification').variables.object
    assert.equal(saved.verification_status, res === 1 ? 'verified' : 'rejected')
    if (res === 1) {
      assert.equal(saved.lookup_summary.id_gender, 'male')
      assert.deepEqual([saved.lookup_summary.province, saved.lookup_summary.city], ['浙江省', '温州市'])
      assert.equal(result.verify, null)
      assert.deepEqual({ ...ops.find((op) => op.name === 'FillProfileFromVerification').variables.patch }, { birthday: '1988-04-09', gender: 'male', household_region: '浙江省 温州市' })
      assert.equal(ops.at(-1).name, 'GrantGuardianRole')
    } else {
      assert.deepEqual(ops.map((op) => op.name), ['ReadCurrentIdentityOwner', 'ReadExistingGuardianVerification', 'UpsertGuardianVerification'])
    }
  }
})
