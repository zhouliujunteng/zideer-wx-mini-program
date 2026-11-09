const assert = require('node:assert/strict')
const test = require('node:test')

const values = new Map()
global.wx = {
  getStorageSync(key) { return values.get(key) },
  setStorageSync(key, value) { values.set(key, value) },
  removeStorageSync(key) { values.delete(key) }
}

const referral = require('../utils/referral-context')

test('referral context survives authentication and profile completion without trusting a target URL', () => {
  referral.clearPendingReferral()
  const token = 'a'.repeat(43)
  const context = referral.captureReferralContext({ token, target: 'https://attacker.example' })
  assert.equal(context.token, token)
  // 待绑定的邀请不再决定落地页：登录与建档后一律回首页，绑定由首页在后台静默完成
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: true }), '/pages/home/index')
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: false }), '/pages/profile-setup/index')
  assert.equal(referral.postProfileUrl(), '/pages/home/index')
  assert.deepEqual(referral.readPendingReferral(), { token, createdAt: context.createdAt })
})

test('a pending promotion code never sends a cold start to the invitation page', () => {
  referral.clearPendingReferral()
  const code = referral.captureReferralContext({ scene: encodeURIComponent('pc=ZLA2B3C4D5') })
  assert.equal(code.code, 'ZLA2B3C4D5')
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: true }), '/pages/home/index')
  assert.equal(referral.postProfileUrl(), '/pages/home/index')
  // 线索仍然留着，供首页兑现或建档页预填
  assert.equal(referral.readPendingReferral().code, 'ZLA2B3C4D5')
})

test('a scanned invitation code never expires, so registering much later still binds the referrer', () => {
  referral.clearPendingReferral()
  referral.captureReferralContext({ pc: 'ZLA2B3C4D5' })
  const stored = values.get('pending_referral_context')
  values.set('pending_referral_context', { ...stored, createdAt: Date.now() - 180 * 24 * 60 * 60 * 1000 })
  assert.equal(referral.readPendingReferral().code, 'ZLA2B3C4D5')
  // 建档页据此预填选填栏；首页据此在后台绑定
  assert.equal(values.has('pending_referral_context'), true)
})

test('invalid and expired invitation context is ignored and removed', () => {
  referral.clearPendingReferral()
  assert.equal(referral.captureReferralContext({ token: 'not valid!' }), null)
  values.set('pending_referral_context', { token: 'b'.repeat(43), createdAt: Date.now() - 25 * 60 * 60 * 1000 })
  assert.equal(referral.readPendingReferral(), null)
  assert.equal(values.has('pending_referral_context'), false)
  assert.equal(referral.postProfileUrl(), '/pages/home/index')
})
