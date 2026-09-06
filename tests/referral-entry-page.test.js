const assert = require('node:assert/strict')
const test = require('node:test')

const config = require('../config/index')
const pages = []
const storage = new Map()

function flowId(query) {
  const match = String(query).match(/actionFlowId:\s*"([^"]+)"/)
  return match ? match[1] : ''
}

global.Page = (definition) => pages.push(definition)
global.wx = {
  getStorageSync(key) { return storage.get(key) || '' },
  setStorageSync(key, value) { storage.set(key, value) },
  removeStorageSync(key) { storage.delete(key) },
  reLaunch() {},
  switchTab() {},
  request(options) {
    const id = flowId(options.data && options.data.query)
    let result = null
    if (id === config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id) result = 1201
    if (id === config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE.id) {
      result = { id: 2201, nickname: '测试用户', current_grade: 8, profile_completed_at: '2026-09-06T00:00:00.000Z' }
    }
    if (id === config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE.id) {
      result = { status: 'deep_gift_granted', deep_gift: true, grant: { id: 3301, grantNo: 'DGR-test', status: 'available' }, touch: { id: 4401 } }
    }
    options.success({ statusCode: 200, data: { data: { result } } })
  }
}

require('../pages/referral-entry/index')
const definition = pages[0]

function createInstance() {
  return {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.assign(this.data, update) },
    processReferral: definition.processReferral
  }
}

test('referral entry recognizes a claimed deep-gift link without reporting attribution', async () => {
  storage.clear()
  const token = 'z'.repeat(43)
  storage.set('zion_runtime_token', 'test-runtime-token')
  storage.set('pending_referral_context', { token, createdAt: Date.now() })
  const page = createInstance()

  await definition.processReferral.call(page)

  assert.equal(page.data.completed, true)
  assert.equal(page.data.isDeepGift, true)
  assert.match(page.data.message, /深测资格已领取/)
  assert.doesNotMatch(page.data.message, /归因/)
  assert.equal(storage.has('pending_referral_context'), false)
})
