const config = require('../config/index')

const TOKEN_KEY = 'zion_runtime_token'

const demoUser = {
  userProfileId: 1,
  profile: {
    id: 1,
    nickname: '知鹿学员',
    real_name: '',
    avatar_id: null,
    status: 'active'
  }
}

const demoSubsidiaries = [
  {
    relation_name: '孩子',
    status: 'active',
    note: '演示账号',
    subsidiary_user: {
      id: 2,
      nickname: '小鹿同学',
      real_name: '',
      avatar_id: null,
      status: 'active'
    }
  }
]

function request({ url, method = 'POST', data, header = {} }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data)
          return
        }
        reject(new Error(`Request failed: ${response.statusCode}`))
      },
      fail: reject
    })
  })
}

function getStoredToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

async function exchangeWeChatCode() {
  if (!config.AUTH_EXCHANGE_URL) {
    throw new Error('微信登录尚未配置，请先在 Zion 绑定小程序并设置 code 换取 JWT 的服务地址。')
  }

  const loginResult = await wx.login()
  const result = await request({
    url: config.AUTH_EXCHANGE_URL,
    data: { code: loginResult.code }
  })

  if (!result.token) {
    throw new Error('微信登录未返回 Zion Runtime JWT。')
  }

  wx.setStorageSync(TOKEN_KEY, result.token)
  return result.token
}

async function getRuntimeToken() {
  const storedToken = getStoredToken()
  return storedToken || exchangeWeChatCode()
}

async function graphql(query, variables) {
  const token = await getRuntimeToken()
  const result = await request({
    url: config.GRAPHQL_URL,
    data: { query, variables },
    header: { Authorization: `Bearer ${token}` }
  })

  if (result.errors && result.errors.length) {
    throw new Error(result.errors[0].message || 'Zion 请求失败。')
  }

  return result.data
}

async function invokeActionFlow(flow) {
  const data = await graphql(
    `mutation InvokeActionFlow($args: Json!) {
      fz_invoke_action_flow(actionFlowId: "${flow.id}", versionId: ${flow.versionId}, args: $args)
    }`,
    { args: {} }
  )
  return data.fz_invoke_action_flow
}

async function loadCurrentUser() {
  if (config.MOCK_MODE) {
    return demoUser
  }
  return invokeActionFlow(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER)
}

async function loadSubsidiaries() {
  if (config.MOCK_MODE) {
    return demoSubsidiaries
  }
  const data = await invokeActionFlow(config.ACTION_FLOWS.LIST_SUBSIDIARIES)
  return data.subsidiaries || []
}

module.exports = {
  loadCurrentUser,
  loadSubsidiaries
}
