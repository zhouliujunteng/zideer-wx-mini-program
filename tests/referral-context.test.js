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
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: true }), '/pages/referral-entry/index')
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: false }), '/pages/profile-setup/index')
  assert.equal(referral.postProfileUrl(), '/pages/referral-entry/index')
  assert.deepEqual(referral.readPendingReferral(), { token, createdAt: context.createdAt })
})

test('invalid and expired invitation context is ignored and removed', () => {
  referral.clearPendingReferral()
  assert.equal(referral.captureReferralContext({ token: 'not valid!' }), null)
  values.set('pending_referral_context', { token: 'b'.repeat(43), createdAt: Date.now() - 25 * 60 * 60 * 1000 })
  assert.equal(referral.readPendingReferral(), null)
  assert.equal(values.has('pending_referral_context'), false)
  assert.equal(referral.postProfileUrl(), '/pages/home/index')
})
