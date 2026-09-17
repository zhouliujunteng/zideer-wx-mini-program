const assert = require('node:assert/strict')
const test = require('node:test')

const servicePath = require.resolve('../services/course-agent-service')

function loadService(storage) {
  delete require.cache[servicePath]
  global.wx = {
    getStorageSync(key) { return storage[key] || '' },
    setStorageSync(key, value) { storage[key] = value },
    removeStorageSync(key) { delete storage[key] },
    request() {}
  }
  return require(servicePath)
}

test('ensureCourseAgentAccess exchanges a Zion JWT for a gateway token and caches it', async () => {
  const storage = {}
  let captured = null
  const service = loadService(storage)
  global.wx.request = (options) => {
    captured = options
    options.success({
      statusCode: 200,
      header: { 'Set-Cookie': 'anonymous_id=owner-1; Path=/; HttpOnly' },
      data: { success: true, token: '1770000000.deadbeef' }
    })
  }
  const token = await service.ensureCourseAgentAccess('zion-jwt-1')
  assert.equal(token, '1770000000.deadbeef')
  assert.equal(captured.header.Authorization, 'Bearer zion-jwt-1')
  assert.ok(captured.url.endsWith('/api/learn/agent-session'))
  // 匿名身份与网关凭证同时出现在出站 Cookie 里
  const cookie = service.readAgentCookieHeader()
  assert.ok(cookie.includes('anonymous_id=owner-1'))
  assert.ok(cookie.includes('openmaic_access=1770000000.deadbeef'))

  // 第二次不再发请求（缓存生效）
  let requestedAgain = false
  global.wx.request = () => { requestedAgain = true }
  const again = await service.ensureCourseAgentAccess('zion-jwt-1')
  assert.equal(again, '1770000000.deadbeef')
  assert.equal(requestedAgain, false)

  // 401 后清缓存，可重新换取
  service.clearCourseAgentAccess()
  assert.equal(service.readAgentCookieHeader(), 'anonymous_id=owner-1')
})

test('ensureCourseAgentAccess rejects invalid credentials without caching', async () => {
  const storage = {}
  const service = loadService(storage)
  global.wx.request = (options) => {
    options.success({ statusCode: 401, header: {}, data: { success: false, error: 'Zion 登录凭证无效或已过期' } })
  }
  await assert.rejects(() => service.ensureCourseAgentAccess('bad-jwt'), /登录凭证无效/)
  assert.equal(service.readAgentCookieHeader(), '')
})

test('ensureCourseAgentAccess requires a login token up front', async () => {
  const service = loadService({})
  await assert.rejects(() => service.ensureCourseAgentAccess(''), /微信登录/)
})
