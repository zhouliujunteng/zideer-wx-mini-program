const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

// 家长绑定学生前必须先完成实名认证（2026-09-24 用户规则）。
const pagePath = require.resolve('../account/bind-student/index.js')
const identityPath = require.resolve('../services/identity.js')

function loadPage({ verification, bind } = {}) {
  delete require.cache[pagePath]
  const bound = []
  require.cache[identityPath] = {
    id: identityPath,
    filename: identityPath,
    loaded: true,
    exports: {
      loadCurrentIdentityVerification: async () => {
        const value = typeof verification === 'function' ? verification() : verification
        return { verification: value || null, roles: [] }
      },
      bindCurrentGuardianToStudent: async (code) => { bound.push(code); return bind ? bind(code) : {} }
    }
  }
  let definition = null
  const navigations = []
  const toasts = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) },
    navigateBack() { navigations.push({ back: true }) },
    showToast(options) { toasts.push(options) }
  }
  require(pagePath)
  delete require.cache[identityPath]
  const instance = { data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values) } }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') instance[key] = value
  return { instance, bound, navigations, toasts }
}

test('an unverified guardian sees the real-name prompt, never the code form', async () => {
  const { instance, bound, navigations } = loadPage({ verification: null })
  assert.equal(instance.data.verificationLoaded, false)
  await instance.onShow()
  assert.equal(instance.data.gate.title, '先完成实名认证')
  instance.onCodeInput({ detail: { value: '12345678' } })
  await instance.submit()
  assert.deepEqual(bound, [])
  instance.openVerification()
  assert.deepEqual(navigations, [{ url: '/account/login-identities/index?verify=1' }])
})

test('pending, rejected and expired verifications each explain what to do next', async () => {
  const cases = [['pending', '实名认证审核中', ''], ['rejected', '实名认证未通过', '重新认证'], ['expired', '实名认证已过期', '重新认证']]
  for (const [status, title, actionLabel] of cases) {
    const { instance } = loadPage({ verification: { verification_status: status } })
    await instance.loadVerification()
    assert.deepEqual([instance.data.gate.title, instance.data.gate.actionLabel], [title, actionLabel], status)
  }
})

test('a verified guardian binds with the code; coming back from verification refreshes the gate', async () => {
  let current = null
  const { instance, bound } = loadPage({ verification: () => current })
  await instance.onShow()
  assert.ok(instance.data.gate)
  current = { verification_status: 'verified' }
  await instance.onShow()
  assert.equal(instance.data.gate, null)
  instance.onCodeInput({ detail: { value: '1234 5678' } })
  await instance.submit()
  assert.deepEqual(bound, ['12345678'])
})

test('a backend rejection for missing verification switches back to the prompt', async () => {
  const { instance } = loadPage({
    verification: { verification_status: 'verified' },
    bind: () => { throw Object.assign(new Error('请先完成家长实名认证。'), { status: 'guardian_verification_required' }) }
  })
  await instance.onShow()
  instance.onCodeInput({ detail: { value: '12345678' } })
  await instance.submit()
  assert.equal(instance.data.gate.title, '先完成实名认证')
  assert.equal(instance.data.submitting, false)
})

test('the first failed status read offers a retry; a later failure keeps the old state', async () => {
  let fail = true
  const { instance } = loadPage({ verification: () => { if (fail) throw new Error('offline'); return { verification_status: 'verified' } } })
  await instance.onShow()
  assert.equal(instance.data.verificationFailed, true)
  fail = false
  await instance.loadVerification()
  assert.equal(instance.data.verificationFailed, false)
  assert.equal(instance.data.gate, null)
  fail = true
  await instance.loadVerification()
  assert.equal(instance.data.verificationFailed, false)
  assert.equal(instance.data.gate, null)
})

test('the page draws a skeleton before the first read and imports the shared skeleton styles', () => {
  const root = path.join(__dirname, '..')
  const wxml = fs.readFileSync(path.join(root, 'account/bind-student/index.wxml'), 'utf8')
  const wxss = fs.readFileSync(path.join(root, 'account/bind-student/index.wxss'), 'utf8')
  assert.match(wxml, /wx:if="\{\{!verificationLoaded && !verificationFailed\}\}"[^>]*>.*class="sk /)
  assert.match(wxss, /@import "\.\.\/\.\.\/styles\/skeleton\.wxss";/)
})

test('a verified guardian under 22 is told why binding failed and offered the identity switch', async () => {
  const { instance, navigations } = loadPage({
    verification: { verification_status: 'verified' },
    bind: () => { const error = new Error('实名认证显示未满 22 周岁，暂不能作为家长绑定学生。'); error.status = 'guardian_underage'; throw error }
  })
  await instance.onShow()
  instance.onCodeInput({ detail: { value: '12345678' } })
  await instance.submit()
  assert.equal(instance.data.gate.title, '暂不能绑定学生')
  assert.match(instance.data.gate.detail, /22 周岁/)
  instance.openVerification()
  assert.deepEqual(navigations.at(-1), { url: '/account/login-identities/index' })
})
