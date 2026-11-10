const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const referral = require('../utils/referral-context')

// 2026-11-10 起没有邀请码 / 推荐人线索（改由爱心妈妈输入家长 ID 绑定家庭），只剩登录、建档后的落地页规则。
test('登录与建档后：没建档去建档页，其余回首页', () => {
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: true }), '/pages/home/index')
  assert.equal(referral.postAuthenticationUrl({ profileCompleted: false }), '/pages/profile-setup/index')
  assert.equal(referral.postAuthenticationUrl(null), '/pages/profile-setup/index')
  assert.equal(referral.postProfileUrl(), '/pages/home/index')
  assert.deepEqual(Object.keys(referral).sort(), ['postAuthenticationUrl', 'postProfileUrl'])
})

test('旧的分享卡片、海报链接仍能打开：推荐入口页直接进首页，不记推荐人', () => {
  const source = fs.readFileSync(path.join(__dirname, '../pages/referral-entry/index.js'), 'utf8')
  assert.match(source, /wx\.reLaunch\(\{ url: '\/pages\/home\/index' \}\)/)
  assert.doesNotMatch(source, /referral-context|captureReferralContext/)
  for (const file of ['app.js', 'pages/home/index.js', 'pages/profile-setup/index.js', 'pages/profile/index.js'])
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /PendingReferral|captureReferralContext|bindCurrentPromotionCode/, file)
})
