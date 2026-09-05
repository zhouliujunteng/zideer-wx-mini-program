const assert = require('node:assert/strict')
const test = require('node:test')

const config = require('../config/index')

const pages = []
const calls = []
const toasts = []

global.Page = (definition) => pages.push(definition)
global.getApp = () => ({ globalData: {} })
global.wx = {
  getStorageSync(key) { return key === 'zion_runtime_token' ? 'test-runtime-token' : '' },
  removeStorageSync() {},
  showToast(options) { toasts.push(options) },
  reLaunch() {},
  request(options) {
    const match = String(options.data && options.data.query).match(/actionFlowId:\s*"([^"]+)"/)
    const id = match && match[1]
    calls.push(id)
    if (id === config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id) {
      options.success({ statusCode: 200, data: { errors: [{ message: 'temporary service unavailable' }] } })
      return
    }
    options.success({ statusCode: 200, data: { data: { result: null } } })
  }
}

require('../pages/profile-setup/index')
const definition = pages[0]

function createInstance() {
  const data = JSON.parse(JSON.stringify(definition.data))
  return {
    data,
    setData(update) {
      Object.entries(update).forEach(([key, value]) => {
        const path = key.split('.')
        let target = this.data
        while (path.length > 1) target = target[path.shift()]
        target[path[0]] = value
      })
    },
    loadProfile: definition.loadProfile,
    validateForm: definition.validateForm
  }
}

test('profile setup blocks saving until its current profile has loaded', async () => {
  calls.length = 0
  toasts.length = 0
  const page = createInstance()

  await definition.onLoad.call(page)
  assert.equal(page.data.loading, false)
  assert.equal(page.data.loadFailed, true)
  assert.deepEqual(calls, [config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id])

  await definition.saveProfile.call(page)
  assert.equal(calls.filter((id) => id === config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE.id).length, 0)
  assert.equal(calls.filter((id) => id === config.ACTION_FLOWS.INITIALIZE_CURRENT_USER.id).length, 2)
  assert.equal(toasts.length, 2)
})
