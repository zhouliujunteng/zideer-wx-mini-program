const { ZION_AGENT_CONFIG, getGraphqlEndpoint } = require('./zion-agent-config')

let silentLoginPromise = null

function readStorage(key) {
  if (!key || !wx.getStorageSync) return ''
  try {
    return wx.getStorageSync(key) || ''
  } catch (error) {
    return ''
  }
}

function getAuthSnapshot() {
  const storedToken = readStorage(ZION_AGENT_CONFIG.authStorageKey)
  const token = typeof storedToken === 'string'
    ? storedToken
    : storedToken && (storedToken.token || storedToken.jwt) || ''
  const accountId = Number(readStorage(ZION_AGENT_CONFIG.accountIdStorageKey))
  return {
    token: String(token || ''),
    accountId: Number.isFinite(accountId) && accountId > 0 ? accountId : null
  }
}

function saveAuthSnapshot(payload) {
  const token = payload && (payload.token || payload.jwt)
  const accountId = Number(payload && (payload.accountId || payload.account_id || payload.account && payload.account.id))
  if (!token || !Number.isFinite(accountId) || accountId <= 0) {
    throw new Error('静默登录返回的 Zion JWT 或 accountId 无效')
  }
  wx.setStorageSync(ZION_AGENT_CONFIG.authStorageKey, String(token))
  wx.setStorageSync(ZION_AGENT_CONFIG.accountIdStorageKey, accountId)
  return { token: String(token), accountId }
}

function readGraphqlError(response) {
  const body = response && response.data
  if (!body || body.errors || !body.data) {
    const statusCode = response && response.statusCode ? `（HTTP ${response.statusCode}）` : ''
    const graphQLError = body && body.errors && body.errors[0]
    const error = new Error(`${graphQLError && graphQLError.message || 'Zion 静默登录失败'}${statusCode}`)
    error.code = graphQLError && graphQLError.extensions && graphQLError.extensions.classification ||
      graphQLError && graphQLError.errorCode || 'ZION_SILENT_LOGIN_FAILED'
    return error
  }
  return null
}

function requestZionRuntimeLogin(code) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: getGraphqlEndpoint(),
      method: 'POST',
      timeout: ZION_AGENT_CONFIG.timeoutMs,
      header: { 'content-type': 'application/json' },
      data: {
        query: `mutation LoginWithWechatMiniApp($code: String!, $createIfNotExists: Boolean) {
          loginWithWechatMiniApp(code: $code, createIfNotExists: $createIfNotExists) {
            account { id }
            jwt { token }
          }
        }`,
        variables: { code, createIfNotExists: true }
      },
      success(response) {
        const error = readGraphqlError(response)
        if (error) {
          reject(error)
          return
        }
        const result = response.data.data.loginWithWechatMiniApp
        try {
          resolve(saveAuthSnapshot({
            token: result && result.jwt && result.jwt.token,
            accountId: result && result.account && result.account.id
          }))
        } catch (saveError) {
          reject(saveError)
        }
      },
      fail: reject
    })
  })
}

function requestSilentLogin(code) {
  const endpoint = String(ZION_AGENT_CONFIG.silentLoginEndpoint || '').trim()
  if (!endpoint) {
    if (ZION_AGENT_CONFIG.useZionRuntimeWechatLogin !== false) return requestZionRuntimeLogin(code)
    const error = new Error('当前未配置微信静默登录换票接口')
    error.code = 'SILENT_LOGIN_ENDPOINT_UNCONFIGURED'
    return Promise.reject(error)
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: endpoint,
      method: 'POST',
      timeout: ZION_AGENT_CONFIG.timeoutMs,
      header: { 'content-type': 'application/json' },
      data: { code, projectExId: ZION_AGENT_CONFIG.projectExId },
      success(response) {
        const body = response && response.data
        const payload = body && (body.data || body)
        try {
          resolve(saveAuthSnapshot(payload))
        } catch (error) {
          reject(error)
        }
      },
      fail: reject
    })
  })
}

function silentLogin() {
  if (!wx.login) return Promise.reject(new Error('当前环境不支持 wx.login'))
  return new Promise((resolve, reject) => {
    wx.login({
      success: (result) => {
        const code = result && result.code
        if (!code) {
          reject(new Error('wx.login 未返回 code'))
          return
        }
        requestSilentLogin(code).then(resolve).catch(reject)
      },
      fail: reject
    })
  })
}

// allowAnonymous 只为当前测试项目未配置微信 AppConfig 时的聊天调试保留；历史始终要求 account_id。
function ensureZionSession({ allowAnonymous = false } = {}) {
  const current = getAuthSnapshot()
  if (current.token && current.accountId) return Promise.resolve(current)
  const hasLoginTransport = String(ZION_AGENT_CONFIG.silentLoginEndpoint || '').trim() ||
    ZION_AGENT_CONFIG.useZionRuntimeWechatLogin !== false
  if (!hasLoginTransport) {
    if (allowAnonymous) return Promise.resolve({ token: '', accountId: null, anonymous: true })
    const error = new Error('查看对话历史前需要完成微信静默登录')
    error.code = 'SILENT_LOGIN_REQUIRED'
    return Promise.reject(error)
  }
  if (!silentLoginPromise) {
    silentLoginPromise = silentLogin().then((auth) => {
      silentLoginPromise = null
      return auth
    }, (error) => {
      silentLoginPromise = null
      const usesZionRuntime = !String(ZION_AGENT_CONFIG.silentLoginEndpoint || '').trim() &&
        ZION_AGENT_CONFIG.useZionRuntimeWechatLogin !== false
      if (allowAnonymous && ZION_AGENT_CONFIG.allowAnonymousDebugFallback && usesZionRuntime &&
        error && error.code === 'PROJECT_CONFIG_NOT_EXISTS') {
        return { token: '', accountId: null, anonymous: true, reason: error.code }
      }
      throw error
    })
  }
  return silentLoginPromise
}

function clearAuthSnapshot() {
  if (wx.removeStorageSync) {
    wx.removeStorageSync(ZION_AGENT_CONFIG.authStorageKey)
    wx.removeStorageSync(ZION_AGENT_CONFIG.accountIdStorageKey)
  }
}

module.exports = {
  getAuthSnapshot,
  saveAuthSnapshot,
  silentLogin,
  ensureZionSession,
  clearAuthSnapshot
}
