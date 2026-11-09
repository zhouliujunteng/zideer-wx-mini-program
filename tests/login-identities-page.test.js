const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../account/login-identities/index.js')
const identityPath = require.resolve('../services/identity.js')

const studentUser = { profileCompleted: true, profile: { id: 7, account_type: 'student', nickname: '周小鹿', gender: 'male', birthday: '2012-06-15', region_detail: '上海市', current_grade: 8, semester: '上学期', school_name: '实验中学', textbook_version: '人教版', avatar_url: 'https://cdn/avatar.png' } }

function loadPage({ principal, me, submit, save, modalConfirm = true, pages = 2 } = {}) {
  delete require.cache[pagePath]
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadCurrentLoginIdentities: async () => (typeof principal === 'function' ? principal() : principal),
      loadCurrentUser: me || (async () => studentUser),
      saveCurrentLearningProfile: save || (async () => ({})),
      submitCurrentGuardianIdentityVerification: submit || (async () => ({ message: '实名认证成功。' }))
    }
  }
  let definition = null
  const navigations = []
  const toasts = []
  const clipboard = []
  const modals = []
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => Array.from({ length: pages }, () => ({}))
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    navigateBack() { navigations.push({ back: true }) },
    showToast(options) { toasts.push(options) },
    showLoading() {},
    hideLoading() {},
    showModal(options) { modals.push(options); if (options.success) options.success({ confirm: modalConfirm }) },
    getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
    getMenuButtonBoundingClientRect: () => ({ top: 26, height: 32, width: 87, left: 283 }),
    setClipboardData(options) { clipboard.push(options.data); if (options.success) options.success() }
  }
  require(pagePath)
  delete require.cache[identityPath]

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  for (const [key, value] of Object.entries(definition)) {
    if (typeof value === 'function') instance[key] = value
  }
  return { instance, navigations, toasts, clipboard, modals }
}

const basePrincipal = {
  principal_no: '100000000000042',
  // 后端仍会带打码邮箱，本页不显示（2026-09-27 去掉邮箱功能）
  contacts: { phone: '185****8585', email: 's***@example.com' },
  account_identities: [
    { id: 'i1', login_channel: 'wechat_miniprogram', verified_at: '2026-09-01T08:00:00Z', last_login_at: '2026-09-18T11:30:00Z', is_default: true },
    { id: 'i2', login_channel: 'phone', disabled_at: '2026-09-02T00:00:00Z' }
  ],
  role_assignments: [{ id: 'r1', role_code: 'guardian' }, { id: 'r2', role_code: 'teacher' }]
}

test('M63 shows the real account: business id, contacts, login methods and roles', async () => {
  const { instance } = loadPage({ principal: basePrincipal })
  await instance.loadPage()
  const { account } = instance.data

  assert.equal(account.principalNo, '100000000000042')
  assert.deepEqual(account.contacts.map(({ label, value, tone }) => [label, value, tone]), [
    ['手机号', '185****8585', 'success']
  ])
  assert.deepEqual(account.identities.map(({ channelLabel, statusLabel, statusTone }) => [channelLabel, statusLabel, statusTone]), [
    ['微信小程序', '当前默认', 'success'],
    ['手机号', '已停用', 'muted']
  ])
  assert.deepEqual(account.roles.map((role) => role.label), ['家长', '服务老师'])
  assert.equal(instance.data.avatarSrc, 'https://cdn/avatar.png')
  assert.equal(instance.data.loading, false)
})

test('the page has no email feature left in its template (2026-09-27)', () => {
  const wxml = require('node:fs').readFileSync(require.resolve('../account/login-identities/index.wxml'), 'utf8')
  assert.doesNotMatch(wxml, /邮箱/)
})

test('M63 real-name card maps every verification state to the designer tones and actions', async () => {
  const cases = [
    [undefined, '未认证', 'muted', '去认证'],
    ['pending', '认证中', 'pending', ''],
    ['verified', '已完成认证', 'success', ''],
    ['rejected', '认证失败', 'failed', '重新提交'],
    ['expired', '认证已过期', 'failed', '重新提交'],
    ['pending_liveness', '未完成认证', 'pending', '继续认证'],
    ['something_new', '未认证', 'muted', '去认证']
  ]
  for (const [status, label, tone, actionLabel] of cases) {
    const principal = { ...basePrincipal, guardian_verification: status ? { verification_status: status, verified_at: '2026-09-12T02:00:00Z' } : null }
    const { instance } = loadPage({ principal })
    await instance.loadPage()
    const { verification } = instance.data.account
    assert.deepEqual([verification.label, verification.tone, verification.actionLabel], [label, tone, actionLabel], String(status))
  }
})

test('M63 never shows a raw English role code, whatever the backend sends', async () => {
  const principal = {
    ...basePrincipal,
    role_assignments: [
      { id: 'r1', role_code: 'GUARDIAN' },
      { id: 'r2', role_code: 'promoter' },
      { id: 'r3', role_code: 'some_new_role' },
      { id: 'r4', role_code: '' }
    ]
  }
  const { instance } = loadPage({ principal })
  await instance.loadPage()

  const labels = instance.data.account.roles.map((role) => role.label)
  assert.deepEqual(labels, ['家长', '推广伙伴', '业务身份', '业务身份'])
  for (const label of labels) assert.ok(!/[A-Za-z_]/.test(label), label)
})

test('M63 falls back to a text avatar when the profile cannot load', async () => {
  const { instance } = loadPage({ principal: basePrincipal, me: async () => { throw new Error('offline') } })
  await instance.loadPage()
  assert.equal(instance.data.avatarSrc, '')
  assert.equal(instance.data.avatarText, '知')
  assert.equal(instance.data.account.principalNo, '100000000000042')
  // 身份卡显示重试，不假装成学生或家长
  assert.equal(instance.data.accountRole, null)
})

const verifiedPrincipal = { ...basePrincipal, guardian_verification: { verification_status: 'verified', verified_at: '2026-09-12T02:00:00Z' } }
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)) }

test('a guardian who registered as guardian is sent to the wizard to fill school, grade and textbook', async () => {
  const guardian = { profileCompleted: true, profile: { ...studentUser.profile, account_type: 'guardian', current_grade: 0, semester: '', school_name: '', textbook_version: '' } }
  const { instance, navigations } = loadPage({ principal: basePrincipal, me: async () => guardian })
  await instance.loadPage()
  assert.deepEqual([instance.data.accountRole.label, instance.data.accountRole.actionLabel], ['家长', '切换为学生'])
  await instance.switchAccountRole()
  assert.deepEqual(navigations, [{ url: '/pages/profile-setup/index?switch=student' }])
})

test('a guardian who used to be a student switches back with the kept school, grade and textbook', async () => {
  let current = { profileCompleted: true, profile: { ...studentUser.profile, account_type: 'guardian' } }
  const saved = []
  const { instance, modals, navigations } = loadPage({
    principal: basePrincipal,
    me: async () => current,
    save: async (form) => { saved.push(form); current = studentUser; return {} }
  })
  await instance.loadPage()
  await instance.switchAccountRole()
  await flush()
  assert.deepEqual(navigations, [])
  assert.match(modals[0].content, /初中2年级上学期 · 实验中学 · 人教版/)
  assert.deepEqual([saved[0].accountType, saved[0].grade, saved[0].semester, saved[0].schoolName, saved[0].textbookVersion], ['student', 8, '上学期', '实验中学', '人教版'])
  assert.equal(instance.data.accountRole.label, '学生')
})

test('a verified student confirms and becomes a guardian while school, grade and textbook are kept', async () => {
  let current = studentUser
  const saved = []
  const { instance, modals, toasts } = loadPage({
    principal: verifiedPrincipal,
    me: async () => current,
    save: async (form) => { saved.push(form); current = { profileCompleted: true, profile: { ...studentUser.profile, account_type: 'guardian' } }; return {} }
  })
  await instance.loadPage()
  assert.deepEqual([instance.data.accountRole.label, instance.data.accountRole.actionLabel], ['学生', '切换为家长'])
  instance.switchAccountRole()
  await flush()
  assert.equal(modals.length, 1)
  assert.doesNotMatch(modals[0].content, /清空/)
  assert.equal(saved.length, 1)
  assert.deepEqual(
    [saved[0].profileId, saved[0].accountType, saved[0].grade, saved[0].semester, saved[0].schoolName, saved[0].textbookVersion, saved[0].nickname, saved[0].gender, saved[0].birthday, saved[0].regionDetail],
    [7, 'guardian', 8, '上学期', '实验中学', '人教版', '周小鹿', 'male', '2012-06-15', '上海市']
  )
  assert.equal(toasts.at(-1).title, '已切换为家长')
  assert.equal(instance.data.accountRole.label, '家长')
  assert.equal(instance.data.switchingRole, false)
})

test('an unverified student must pass real-name verification first, then the switch continues', async () => {
  let principal = basePrincipal
  let current = studentUser
  const saved = []
  const { instance, modals } = loadPage({
    principal: () => principal,
    me: async () => current,
    submit: async () => { principal = verifiedPrincipal; return { message: '实名认证成功' } },
    save: async (form) => { saved.push(form); current = { profileCompleted: true, profile: { ...studentUser.profile, account_type: 'guardian' } }; return {} }
  })
  await instance.loadPage()
  instance.switchAccountRole()
  assert.equal(modals[0].title, '先完成实名认证')
  assert.equal(instance.data.realNameSheetVisible, true)
  assert.deepEqual(saved, [])
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '11010519491231002X' } })
  await instance.submitRealNameVerification()
  await flush()
  assert.equal(saved.length, 1)
  assert.equal(saved[0].accountType, 'guardian')
})

test('the backend age rule is explained instead of a bare toast', async () => {
  const { instance, modals, toasts } = loadPage({
    principal: verifiedPrincipal,
    save: async () => { const error = new Error('实名认证显示未满 22 周岁，不能切换为家长。'); error.code = 'GUARDIAN_UNDERAGE'; throw error }
  })
  await instance.loadPage()
  instance.switchAccountRole()
  await flush()
  assert.equal(modals.at(-1).title, '暂不能切换为家长')
  assert.match(modals.at(-1).content, /22 周岁/)
  assert.equal(toasts.some((toast) => toast.title === '已切换为家长'), false)
  assert.equal(instance.data.accountRole.label, '学生')
})

test('cancelling the guardian switch saves nothing; incomplete basic info goes to the wizard instead', async () => {
  const cancelled = loadPage({ principal: verifiedPrincipal, modalConfirm: false, save: async () => { throw new Error('should not save') } })
  await cancelled.instance.loadPage()
  cancelled.instance.switchAccountRole()
  assert.equal(cancelled.instance.data.switchingRole, false)
  assert.equal(cancelled.instance.data.realNameSheetVisible, false)

  const legacy = { profileCompleted: true, profile: { ...studentUser.profile, gender: '', birthday: '' } }
  const saved = []
  const { instance, navigations } = loadPage({ principal: verifiedPrincipal, me: async () => legacy, save: async (form) => { saved.push(form) } })
  await instance.loadPage()
  await instance.switchToGuardian()
  assert.deepEqual(saved, [])
  assert.deepEqual(navigations, [{ url: '/pages/profile-setup/index?switch=guardian' }])
})

test('opened with verify=1 the real-name sheet pops up and a verified result returns to the binding page', async () => {
  let current = basePrincipal
  const { instance, navigations } = loadPage({
    principal: () => current,
    submit: async () => { current = { ...basePrincipal, guardian_verification: { verification_status: 'verified' } }; return { message: '实名认证成功。' } }
  })
  instance.onLoad({ verify: '1' })
  await instance.loadPage()
  assert.equal(instance.data.realNameSheetVisible, true)
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '110105194912310021' } })
  await instance.submitRealNameVerification()
  await sleep(1300)
  assert.deepEqual(navigations, [{ back: true }])
})

test('verify=1 does not pop the sheet for an account that is already verified', async () => {
  const { instance } = loadPage({ principal: { ...basePrincipal, guardian_verification: { verification_status: 'verified' } } })
  instance.onLoad({ verify: '1' })
  await instance.loadPage()
  assert.equal(instance.data.realNameSheetVisible, false)
})

test('M63 copies the business id and goes back', async () => {
  const { instance, navigations, clipboard } = loadPage({ principal: basePrincipal })
  await instance.loadPage()

  instance.copyAccountId()
  instance.handleBack()

  assert.deepEqual(navigations, [{ back: true }])
  assert.deepEqual(clipboard, ['100000000000042'])
})

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('the real-name sheet only offers the ID card the backend can verify', async () => {
  const { instance } = loadPage({ principal: basePrincipal })
  instance.openRealNameVerification()
  assert.equal(instance.data.realNameSheetVisible, true)
  assert.deepEqual(instance.data.realNameDocumentTypeLabels, ['身份证'])
})

test('the real-name sheet validates locally before calling the backend', async () => {
  const submitted = []
  const { instance, toasts } = loadPage({ principal: basePrincipal, submit: async (form) => { submitted.push(form); return {} } })
  instance.openRealNameVerification()

  await instance.submitRealNameVerification()
  instance.handleRealNameNameInput({ detail: { value: ' 周小鹿 ' } })
  instance.handleRealNameIdInput({ detail: { value: '11010519491231002' } })
  await instance.submitRealNameVerification()

  assert.deepEqual(submitted, [])
  assert.deepEqual(toasts.map((toast) => toast.title), ['请输入姓名', '请输入正确的身份证号'])
})

test('a verified submission closes the sheet and refreshes the status to verified', async () => {
  let current = basePrincipal
  const submitted = []
  const { instance, toasts } = loadPage({
    principal: () => current,
    submit: async (form) => {
      submitted.push(form)
      current = { ...basePrincipal, guardian_verification: { verification_status: 'verified', verified_at: '2026-09-19T05:00:00Z' } }
      return { message: '实名认证成功。' }
    }
  })
  await instance.loadPage()
  assert.equal(instance.data.account.verification.label, '未认证')
  instance.openRealNameVerification()
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '11010519491231002x' } })

  await instance.submitRealNameVerification()
  await sleep(320)

  assert.deepEqual(submitted, [{ name: '周小鹿', idCardNumber: '11010519491231002X' }])
  assert.equal(instance.data.realNameSheetVisible, false)
  assert.equal(instance.data.account.verification.label, '已完成认证')
  assert.equal(toasts.at(-1).title, '实名认证成功。')
})

test('a rejected submission keeps the sheet open and shows the reason', async () => {
  const { instance } = loadPage({ principal: basePrincipal, submit: async () => { throw new Error('姓名与身份证号不匹配') } })
  instance.openRealNameVerification()
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '110105194912310021' } })

  await instance.submitRealNameVerification()

  assert.equal(instance.data.realNameSheetVisible, true)
  assert.equal(instance.data.realNameSubmitting, false)
  assert.equal(instance.data.realNameError, '姓名与身份证号不匹配')
})

test('while verifying, the sheet ignores repeat taps and cannot be closed', async () => {
  let release
  let calls = 0
  const { instance } = loadPage({ principal: basePrincipal, submit: () => { calls += 1; return new Promise((resolve) => { release = resolve }) } })
  instance.openRealNameVerification()
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '110105194912310021' } })

  const pending = instance.submitRealNameVerification()
  instance.submitRealNameVerification()
  instance.closeRealNameVerification()

  assert.equal(calls, 1)
  assert.equal(instance.data.realNameSheetClosing, false)
  release({})
  await pending
})

test('the sheet lifts above the keyboard', () => {
  const { instance } = loadPage({ principal: basePrincipal })
  instance.openRealNameVerification()
  instance.handleRealNameKeyboard({ detail: { height: 291 } })
  assert.equal(instance.data.realNameKeyboardHeight, 291)
  instance.handleRealNameKeyboard({ detail: { height: 0 } })
  assert.equal(instance.data.realNameKeyboardHeight, 0)
})

test('M63 refuses to copy a placeholder id before the account is initialised', async () => {
  const { instance, clipboard, toasts } = loadPage({ principal: { ...basePrincipal, principal_no: '' } })
  await instance.loadPage()
  instance.copyAccountId()
  assert.deepEqual(clipboard, [])
  assert.equal(toasts.at(-1).title, '暂无可复制的 ID')
})

// 2026-09-29 起普通实名不再刷脸：两步实名时留下的「未完成认证」重新提交姓名和身份证号就完成，接着切换家长，不打开人脸核验页
test('a record left waiting for the old face check finishes with the name and ID number and the switch continues', async () => {
  let principal = { ...basePrincipal, guardian_verification: { verification_status: 'pending_liveness' } }
  let current = studentUser
  const saved = []
  const { instance, navigations } = loadPage({
    principal: () => principal,
    me: async () => current,
    submit: async () => { principal = verifiedPrincipal; return { message: '实名认证成功' } },
    save: async (form) => { saved.push(form); current = { profileCompleted: true, profile: { ...studentUser.profile, account_type: 'guardian' } }; return {} }
  })
  await instance.loadPage()
  assert.equal(instance.data.account.verification.label, '未完成认证')
  instance.switchAccountRole()
  instance.handleRealNameNameInput({ detail: { value: '周小鹿' } })
  instance.handleRealNameIdInput({ detail: { value: '11010519491231002x' } })
  await instance.submitRealNameVerification()
  await flush()
  assert.equal(navigations.some((item) => /liveness/.test(item.url || '')), false, 'ordinary real-name verification never opens the face check')
  assert.equal(saved.length, 1)
  assert.equal(saved[0].accountType, 'guardian')
})
