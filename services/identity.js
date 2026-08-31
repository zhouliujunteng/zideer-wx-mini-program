const config = require('../config/index')

const TOKEN_KEY = 'zion_runtime_token'

const demoUser = {
  userProfileId: 1,
  profile: {
    id: 1,
    nickname: '知鹿学员',
    real_name: '',
    avatar_id: null,
    status: 'active',
    roles: [
      { role_code: 'USER', status: 'active' }
    ]
  }
}

const demoLearners = [
  {
    id: 1,
    nickname: '知鹿学员',
    real_name: '',
    relation_name: '本人',
    plans: [
      {
        id: 101,
        plan_name: '小学数学思维提升',
        status: 'active',
        starts_at: '2026-09-03T10:00:00+08:00',
        ends_at: '2026-12-20T10:00:00+08:00',
        course: { id: 11, title: '小学数学思维提升', introduction: '建立稳定的思维方法。' },
        schedules: [
          { id: 1001, title: '数感与估算', scheduled_at: '2026-09-03T10:00:00+08:00', duration_minutes: 60, status: 'scheduled' },
          { id: 1002, title: '图形推理', scheduled_at: '2026-09-10T10:00:00+08:00', duration_minutes: 60, status: 'scheduled' }
        ]
      }
    ]
  },
  {
    id: 2,
    nickname: '小鹿同学',
    real_name: '',
    relation_name: '孩子',
    plans: [
      {
        id: 102,
        plan_name: '阅读表达私课',
        status: 'active',
        starts_at: '2026-09-05T19:30:00+08:00',
        ends_at: '2026-12-25T19:30:00+08:00',
        course: { id: 12, title: '阅读表达私课', introduction: '在阅读中建立表达能力。' },
        schedules: [
          { id: 1003, title: '人物与观点', scheduled_at: '2026-09-05T19:30:00+08:00', duration_minutes: 60, status: 'scheduled' }
        ]
      }
    ]
  }
]

const demoHome = {
  hasActivePlan: true,
  plans: demoLearners[0].plans,
  courses: [
    { id: 11, title: '小学数学思维提升', introduction: '建立数感、逻辑和解决问题的稳定方法。', status: 'published' },
    { id: 12, title: '阅读表达私课', introduction: '通过深度阅读，获得清晰、准确的表达能力。', status: 'published' }
  ]
}

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
    return demoLearners.slice(1).map((learner) => ({
      relation_name: learner.relation_name,
      status: 'active',
      subsidiary_user: {
        id: learner.id,
        nickname: learner.nickname,
        real_name: learner.real_name,
        status: 'active'
      }
    }))
  }
  const data = await invokeActionFlow(config.ACTION_FLOWS.LIST_SUBSIDIARIES)
  return data.subsidiaries || []
}

async function loadCourseHome() {
  if (config.MOCK_MODE) {
    return demoHome
  }
  const data = await invokeActionFlow(config.ACTION_FLOWS.COURSE_HOME)
  return data.home || { hasActivePlan: false, plans: [], courses: [] }
}

async function loadStudyLearners() {
  if (config.MOCK_MODE) {
    return demoLearners
  }
  const data = await invokeActionFlow(config.ACTION_FLOWS.STUDY_LEARNERS)
  return data.learners || []
}

module.exports = {
  loadCurrentUser,
  loadSubsidiaries,
  loadCourseHome,
  loadStudyLearners
}
