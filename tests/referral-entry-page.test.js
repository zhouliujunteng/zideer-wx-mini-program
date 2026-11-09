const assert = require('node:assert/strict')
const test = require('node:test')

const pages = []
const routes = []
const storage = new Map()

global.Page = (definition) => pages.push(definition)
global.wx = {
  getStorageSync(key) { return storage.get(key) || '' },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  reLaunch(options) { routes.push(options.url) }
}

require('../pages/referral-entry/index')
const definition = pages[0]

function open(options) {
  storage.clear()
  routes.length = 0
  definition.onLoad(options)
}

test('a shared invitation link keeps the invite and lands on the home tab, never on a full invitation page', () => {
  const token = 'z'.repeat(43)
  open({ token })
  // 线索留给首页在后台兑现；用户看到的是首页，不是「推广伙伴邀请」整页
  assert.equal(storage.get('pending_referral_context').token, token)
  assert.deepEqual(routes, ['/pages/home/index'])
})

test('a promotion code carried by the link is captured the same way', () => {
  open({ pc: 'ZLA2B3C4D5' })
  assert.equal(storage.get('pending_referral_context').code, 'ZLA2B3C4D5')
  assert.deepEqual(routes, ['/pages/home/index'])
})

test('opening the link without any invite still goes straight home and stores nothing', () => {
  open({})
  assert.equal(storage.has('pending_referral_context'), false)
  assert.deepEqual(routes, ['/pages/home/index'])
})
