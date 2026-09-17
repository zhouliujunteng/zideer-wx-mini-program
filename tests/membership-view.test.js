const test = require('node:test')
const assert = require('node:assert/strict')
const { membershipView } = require('../services/membership-view')

const now = Date.parse('2026-09-16T04:00:00Z')
const gold = { status: 'active', eligible: true, permanent: true, expiresAt: null, activeAt: '2026-09-16T03:30:00Z',
  tier: { productVersionId: '51', name: '黄金会员', amount: '99.00', creditAmount: '1000' } }

test('a paid tier displays its name as permanent membership with gifted credits', () => {
  const view = membershipView(gold, now)
  assert.equal(view.active, true)
  assert.equal(view.permanent, true)
  assert.equal(view.tierLabel, '黄金会员')
  assert.equal(view.validityText, '永久有效')
  assert.equal(view.giftCreditsText, '开通赠送 1000 积分')
  assert.equal(view.remainingText, '')
  assert.equal(view.libraryLabel, '永久可用')
})
test('a zero-credit tier shows no gift line', () => {
  assert.equal(membershipView({ ...gold, tier: { ...gold.tier, creditAmount: '0' } }, now).giftCreditsText, '')
})
test('the earlier 7-day test membership still shows its expiry', () => {
  const trial = { status: 'active', eligible: true, permanent: false, expiresAt: '2026-09-17T03:30:00Z', tier: { name: '7天测试会员', creditAmount: '0' } }
  const view = membershipView(trial, now)
  assert.equal(view.active, true)
  assert.equal(view.remainingText, '剩余 1 天')
  assert.match(view.validityText, /到期/)
  assert.equal(membershipView(trial, Date.parse('2026-09-18T00:00:00Z')).active, false)
})
test('unpaid, refunded, closed and malformed results never display a member', () => {
  for (const value of [
    { ...gold, status: 'pending', eligible: false },
    { ...gold, status: 'refunded', eligible: false },
    { ...gold, status: 'closed', eligible: false },
    { ...gold, tier: null },
    { ...gold, eligible: 'true' },
    { ...gold, permanent: true, expiresAt: '2026-09-17T00:00:00Z' }
  ]) {
    assert.equal(membershipView(value, now).active, false)
    assert.equal(membershipView(value, now).tierLabel, '普通用户')
  }
})
test('missing membership remains unknown instead of presenting an ordinary-user decision', () => {
  assert.equal(membershipView(null, now).tierLabel, '等级待确认')
  assert.equal(membershipView(null, now).active, false)
})
