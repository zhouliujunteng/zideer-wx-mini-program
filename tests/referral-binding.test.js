const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')

const values = new Map()
global.wx = {
  getStorageSync(key) { return values.get(key) },
  setStorageSync(key, value) { values.set(key, value) },
  removeStorageSync(key) { values.delete(key) }
}

const referral = require('../utils/referral-context')
const source = fs.readFileSync(require.resolve('../services/referral-binding.js'), 'utf8')

// 每次都装一份新的模块：它带并发与静默重试的内部状态，用例之间不能互相污染。
function loadBinding(identity) {
  const calls = []
  const stub = {
    isAuthenticationRequired: (error) => /AUTH_REQUIRED/.test(String(error && error.message)),
    async loadCurrentUser() { calls.push('user'); return identity.user === undefined ? { profileCompleted: true } : identity.user },
    async bindCurrentPromotionCode(code) { calls.push(`bind:${code}`); if (identity.bindError) throw identity.bindError; return identity.bound },
    async recordCurrentPromotionTouchAndAttribute(input) { calls.push(`attribute:${input.invitationToken}`); if (identity.attributeError) throw identity.attributeError; return identity.attributed }
  }
  const module = { exports: {} }
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name) => name.includes('identity') ? stub : referral
  })
  return { resolve: module.exports.resolvePendingReferral, calls }
}

function pendingCode(code) {
  referral.clearPendingReferral()
  referral.captureReferralContext({ pc: code })
}

test('a scanned promotion code is bound in the background and then dropped', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve, calls } = loadBinding({ bound: { alreadyBound: false, referrer: { name: '李老师' } } })
  const result = await resolve()
  assert.equal(result.bound, true)
  assert.match(result.message, /已绑定推荐人：李老师/)
  assert.deepEqual(calls, ['user', 'bind:ZLA2B3C4D5'])
  assert.equal(referral.readPendingReferral(), null)
})

test('when the credit campaign is on, the silent bind says how much landed', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve } = loadBinding({ bound: { alreadyBound: false, referrer: { name: '李老师' }, rewardCredits: 2000 } })
  const result = await resolve()
  assert.match(result.message, /已绑定推荐人：李老师，获得 2000 积分/)
})

test('an already attributed user is told once and the code stops coming back', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve } = loadBinding({ bound: { alreadyBound: true, referrer: { name: '王老师' } } })
  const result = await resolve()
  assert.equal(result.bound, false)
  assert.match(result.message, /已有推荐人/)
  assert.equal(referral.readPendingReferral(), null)
})

test('the code waits for an unfinished profile instead of being spent or shown', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve, calls } = loadBinding({ user: { profileCompleted: false } })
  assert.equal(await resolve(), null)
  assert.deepEqual(calls, ['user'])
  // 建档页会把它预填进选填栏，所以线索必须留着
  assert.equal(referral.readPendingReferral().code, 'ZLA2B3C4D5')
})

test('a code that can never bind is dropped, so it cannot hijack later launches', async () => {
  pendingCode('ZLA2B3C4D5')
  const selfCode = Object.assign(new Error('不能填写自己的邀请码。'), { promotionStatus: 'self_code', terminalReferral: true })
  const { resolve } = loadBinding({ bindError: selfCode })
  assert.equal(await resolve(), null)
  assert.equal(referral.readPendingReferral(), null)
})

test('a network failure keeps the code but stays quiet instead of retrying on every tab switch', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve, calls } = loadBinding({ bindError: new Error('邀请码服务暂时不可用，请稍后重试。') })
  assert.equal(await resolve(), null)
  assert.equal(referral.readPendingReferral().code, 'ZLA2B3C4D5')
  assert.equal(await resolve(), null)
  assert.deepEqual(calls, ['user', 'bind:ZLA2B3C4D5'])
})

test('a login failure keeps the code ready for the attempt right after signing in', async () => {
  pendingCode('ZLA2B3C4D5')
  const { resolve, calls } = loadBinding({ bindError: new Error('AUTH_REQUIRED') })
  assert.equal(await resolve(), null)
  assert.equal(await resolve(), null)
  assert.deepEqual(calls, ['user', 'bind:ZLA2B3C4D5', 'user', 'bind:ZLA2B3C4D5'])
  assert.equal(referral.readPendingReferral().code, 'ZLA2B3C4D5')
})

test('a shared deep-gift link is claimed in the background and reported in one line', async () => {
  referral.clearPendingReferral()
  const token = 'z'.repeat(43)
  referral.captureReferralContext({ token })
  const { resolve, calls } = loadBinding({ attributed: { reused: false, isDeepGift: true } })
  const result = await resolve()
  assert.match(result.message, /深测资格已领取/)
  assert.deepEqual(calls, ['user', `attribute:${token}`])
  assert.equal(referral.readPendingReferral(), null)
})

test('nothing pending means no request at all', async () => {
  referral.clearPendingReferral()
  const { resolve, calls } = loadBinding({})
  assert.equal(await resolve(), null)
  assert.deepEqual(calls, [])
})
