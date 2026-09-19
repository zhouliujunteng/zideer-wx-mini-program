const assert = require('node:assert/strict')
const test = require('node:test')

const pagePath = require.resolve('../account/login-identities/index.js')
const identityPath = require.resolve('../services/identity.js')

function loadPage({ principal, me, submit } = {}) {
  delete require.cache[pagePath]
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadCurrentLoginIdentities: async () => (typeof principal === 'function' ? principal() : principal),
      loadMeDashboard: me || (async () => ({ profile: { avatarUrl: 'https://cdn/avatar.png', initial: '周' } })),
      submitCurrentGuardianIdentityVerification: submit || (async () => ({ message: '实名认证成功。' }))
    }
  }
  let definition = null
  const navigations = []
  const toasts = []
  const clipboard = []
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    navigateBack() { navigations.push({ back: true }) },
    showToast(options) { toasts.push(options) },
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
  return { instance, navigations, toasts, clipboard }
}

const basePrincipal = {
  principal_no: '100000000000042',
  contacts: { phone: '185****8585', email: '' },
  account_identities: [
    { id: 'i1', login_channel: 'wechat_miniprogram', verified_at: '2026-09-01T08:00:00Z', last_login_at: '2026-09-18T11:30:00Z', is_default: true },
    { id: 'i2', login_channel: 'phone', disabled_at: '2026-09-02T00:00:00Z' }
  ],
  role_assignments: [{ id: 'r1', role_code: 'GUARDIAN' }]
}

test('M63 shows the real account: business id, contacts, login methods and roles', async () => {
  const { instance } = loadPage({ principal: basePrincipal })
  await instance.loadPage()
  const { account } = instance.data

  assert.equal(account.principalNo, '100000000000042')
  assert.deepEqual(account.contacts.map(({ label, value, tone }) => [label, value, tone]), [
    ['手机号', '185****8585', 'success'],
    ['邮箱', '未绑定', 'muted']
  ])
  assert.deepEqual(account.identities.map(({ channelLabel, statusLabel, statusTone }) => [channelLabel, statusLabel, statusTone]), [
    ['微信小程序', '当前默认', 'success'],
    ['手机号', '已停用', 'muted']
  ])
  assert.equal(account.roles[0].label, '家长')
  assert.equal(instance.data.avatarSrc, 'https://cdn/avatar.png')
  assert.equal(instance.data.loading, false)
})

test('M63 real-name card maps every verification state to the designer tones and actions', async () => {
  const cases = [
    [undefined, '未认证', 'muted', '去认证'],
    ['pending', '认证中', 'pending', ''],
    ['verified', '已完成认证', 'success', ''],
    ['rejected', '认证失败', 'failed', '重新提交'],
    ['expired', '认证已过期', 'failed', '重新提交'],
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

test('M63 falls back to a text avatar when the profile cannot load', async () => {
  const { instance } = loadPage({ principal: basePrincipal, me: async () => { throw new Error('offline') } })
  await instance.loadPage()
  assert.equal(instance.data.avatarSrc, '')
  assert.equal(instance.data.avatarText, '知')
  assert.equal(instance.data.account.principalNo, '100000000000042')
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
