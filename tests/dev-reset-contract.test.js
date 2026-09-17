const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = path.join(__dirname, '..')
const config = require('../config/index')

test('development reset is globally registered but guarded by build and server checks', () => {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'))
  assert.equal(app.usingComponents['dev-reset-fab'], '/components/dev-reset-fab/index')

  const pages = [...(app.pages || [])]
  for (const subpackage of app.subpackages || []) {
    for (const page of subpackage.pages || []) pages.push(`${subpackage.root}/${page}`)
  }

  for (const page of pages) {
    const template = fs.readFileSync(path.join(root, `${page}.wxml`), 'utf8')
    assert.match(template, /<dev-reset-fab\s*\/>/, page)
  }

  const component = fs.readFileSync(path.join(root, 'components/dev-reset-fab/index.js'), 'utf8')
  assert.match(component, /envVersion === 'develop'/)
  assert.match(component, /wx\.showModal/)
  assert.match(component, /resetDevelopmentAccount\(\)/)
  assert.match(component, /wx\.reLaunch\(\{ url: '\/pages\/login\/login' \}\)/)
  assert.match(component, /DEV_RESET_FORBIDDEN/)
  assert.doesNotMatch(component, /title: error\.message \|\| '重置失败/)

  const actionFlow = fs.readFileSync(path.join(root, 'config/index.js'), 'utf8')
  assert.match(actionFlow, /RESET_DEVELOPMENT_ACCOUNT[\s\S]*2849f6c0-520f-edff-e4dc-176919ba296b/)
})

test('development reset clears local state only after the server confirms reopen', async () => {
  let token = 'test-runtime-token'
  let cleared = false
  const flowIds = []

  global.wx = {
    getStorageSync(key) { return key === 'zion_runtime_token' ? token : '' },
    removeStorageSync(key) { if (key === 'zion_runtime_token') token = '' },
    clearStorageSync() { cleared = true; token = '' },
    setStorageSync(key, value) { if (key === 'zion_runtime_token') token = value },
    request(options) {
      const query = String(options.data && options.data.query || '')
      const match = query.match(/actionFlowId:\s*"([^"]+)"/)
      const flowId = match ? match[1] : ''
      flowIds.push(flowId)
      const result = flowId === config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE.id
        ? { authenticated: true, phoneVerified: true }
        : { status: 'reopened' }
      options.success({ statusCode: 200, data: { data: { result } } })
    }
  }
  global.getApp = () => ({ globalData: { user: { id: 'old' } } })

  const identity = require('../services/identity')
  identity.resetPhoneSessionVerification()
  await identity.resetDevelopmentAccount()

  assert.equal(cleared, true)
  assert.equal(token, '')
  assert.deepEqual(flowIds, [config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE.id, config.ACTION_FLOWS.RESET_DEVELOPMENT_ACCOUNT.id])
})
