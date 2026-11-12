const config = require('../config/index')
const { courseGenerationState, courseCreditState, courseTaskProgress } = require('../utils/course-state')
const { isEnterpriseWechatContact } = require('../utils/customer-service')
const display = require('../utils/business-labels')
const { summarizeLearnerBaseline, summarizeLearningPreference, summarizeLearningGoal, summarizeGoalMap } = require('../utils/learner-baseline')
const { isAgentCourseId, normalizeAgentCourse } = require('../utils/agent-course-view')
const { rememberAccountType, clearAccountType } = require('../utils/account-role')
const { readDevResetCode, rememberDevResetCode, forgetDevResetCode } = require('../utils/dev-reset')
const { assertPaymentOpen, paymentClosedMessage } = require('./payment-switch')

const TOKEN_KEY = 'zion_runtime_token'
let authRedirectInProgress = false
let verifiedPhoneToken = ''
let phoneVerificationFlight = null
let identityVerificationFlight = null
let sessionGeneration = 0

function resetPhoneSessionVerification() { verifiedPhoneToken = ''; phoneVerificationFlight = null }

// 未登录也能浏览的页面（2026-09-27 用户规则，按微信小程序平台规则：不能强制登录后才看得到功能）。
// 在这些页面上发现没登录或登录失效，只作废本地凭证、把错误交给页面显示游客状态，不跳登录页。
const GUEST_BROWSABLE_ROUTES = [
  'account/help-center/index',
  'account/help-guide/index',
  'account/help-feedback/index',
  'pages/splash/index',
  'pages/home/index',
  'pages/learning/index',
  'pages/knowledge-universe/index',
  'pages/knowledge-map/index',
  'pages/goal/index',
  'pages/me/index',
  'learning/library/index',
  // 家长「学习报告」：服务号报告卡片点进来时可能还没登录，页面自己显示登录提示（2026-10-07）
  'account/parent-reports/index',
  // 物理实验室：纯静态网页，不读任何数据，游客也能看（2026-10-08）
  'score-tools/physics-lab/index',
  'learning/custom-course-intro/index'
]

function createAuthenticationRequiredError() {
  const error = new Error('登录状态已失效，请重新登录。')
  error.code = 'AUTH_REQUIRED'
  return error
}

// 已登录、还没完善学习档案：要档案的数据读不到，页面据 code 提示去完善，不当成读取失败。
function createProfileRequiredError(message = '请先完善学习资料。') {
  const error = new Error(message)
  error.code = 'PROFILE_REQUIRED'
  return error
}

function isProfileRequired(error) {
  return Boolean(error && error.code === 'PROFILE_REQUIRED')
}

function currentRoute() {
  if (typeof getCurrentPages !== 'function') return ''
  const pages = getCurrentPages()
  const page = pages && pages[pages.length - 1]
  return page && page.route ? String(page.route) : ''
}

function requireAuthentication() {
  // 本来就没有凭证（游客）时没有会话可作废：不动 sessionGeneration，免得打断正在进行的登录
  if (getStoredToken()) {
    sessionGeneration += 1
    wx.removeStorageSync(TOKEN_KEY)
    // 失效后按游客浏览：底栏不再按上个账号的身份（家长四项）画
    clearAccountType()
    resetPhoneSessionVerification()
    if (typeof getApp === 'function') { const app = getApp(); if (app && app.globalData) app.globalData.user = null }
  }

  // All protected pages use this recovery path, so expired sessions do not
  // present themselves as business-data loading failures.
  const route = currentRoute()
  if (!authRedirectInProgress && route !== 'pages/login/login' && !GUEST_BROWSABLE_ROUTES.includes(route)) {
    authRedirectInProgress = true
    try {
      // 登录页打开后就放开：用户点「先随便看看」离开后，再进要登录的页面还能被带去登录
      wx.reLaunch({ url: '/pages/login/login', complete: () => { authRedirectInProgress = false } })
    } catch (error) {
      authRedirectInProgress = false
    }
  }

  return createAuthenticationRequiredError()
}

function isAuthenticationRequired(error) {
  return Boolean(error && (error.code === 'AUTH_REQUIRED' || error.code === 'PHONE_REQUIRED'))
}

function requirePhoneAuthorization() {
  const error = requireAuthentication()
  error.code = 'PHONE_REQUIRED'
  error.message = '请授权手机号后完成登录。'
  return error
}

async function invokePhoneFlow(token, flow, args = {}) {
  const response = await request({
    url: config.GRAPHQL_URL,
    header: { Authorization: `Bearer ${token}` },
    data: { query: `mutation PhoneAuthentication($args: Json!) { result: fz_invoke_action_flow_default_by_latest_version(actionFlowId: "${flow.id}", args: $args) }`, variables: { args } },
    timeout: 30000
  })
  if (response.errors && response.errors.length) {
    const message = response.errors[0].message || ''
    if (isRuntimeTokenRejection(message)) throw createAuthenticationRequiredError()
    const messages = {
      PHONE_CODE_REQUIRED: '请点击按钮重新授权手机号。',
      PHONE_CODE_EXPIRED: '手机号授权已过期，请重新授权。',
      PHONE_ALREADY_BOUND: '该手机号已绑定其他账号，请联系服务人员处理。',
      PHONE_BIND_CHANGED: '账号绑定状态已变化，请重新登录。',
      PHONE_LOGIN_REQUIRED: '微信登录已失效，请重新授权。',
      PHONE_BIND_FAILED: '手机号绑定未完成，请重试。',
      PHONE_PROVIDER_UNAVAILABLE: '手机号授权服务暂不可用，请稍后重试。'
    }
    const key = Object.keys(messages).find(key => message.includes(key))
    throw new Error(key ? messages[key] : '手机号登录状态暂时无法确认，请稍后重试。')
  }
  return parseActionFlowResult(response.data && response.data.result)
}

async function verifyPhoneToken(token) {
  const state = await invokePhoneFlow(token, config.ACTION_FLOWS.GET_PHONE_LOGIN_STATE)
  if (!state || state.authenticated !== true) throw createAuthenticationRequiredError()
  if (state.phoneVerified !== true) { const error = new Error('请授权手机号后完成登录。'); error.code = 'PHONE_REQUIRED'; throw error }
  return state
}

function isRuntimeTokenRejection(message) {
  const value = String(message || '')
  // An action flow or a permission rule may use "unauthenticated" in an
  // ordinary GraphQL business error. Only discard the saved session when the
  // backend explicitly identifies the JWT or bearer token as invalid.
  return /\bjwt\b|\bbearer\s+token\s+(?:is\s+)?(?:expired|invalid|rejected)\b|\btoken\s+(?:is\s+)?(?:expired|invalid|rejected)\b|\bauthentication\s+token\s+(?:is\s+)?(?:expired|invalid|failed)\b/i.test(value)
}

function request({ url, method = 'POST', data, header = {}, timeout, timeoutMessage }) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method,
      data,
      header,
      timeout,
      success: (response) => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data)
          return
        }
        reject(new Error(`Request failed: ${response.statusCode}`))
      },
      fail: (error) => {
        if (/timeout/i.test(String(error && error.errMsg || ''))) {
          reject(new Error(timeoutMessage || '服务暂时不可用，请稍后重试。'))
          return
        }
        reject(error)
      }
    })
  })
}

function getStoredToken() {
  return wx.getStorageSync(TOKEN_KEY) || ''
}

// 本机有没有登录凭证：没有就是游客，页面直接显示游客状态，不发要登录的请求。
// 有凭证不代表一定有效，失效时由请求走 requireAuthentication 作废。
function hasSession() {
  return Boolean(getStoredToken())
}

async function getWechatLoginCode() {
  const loginResult = await new Promise((resolve, reject) => {
    wx.login({ success: resolve, fail: reject })
  })

  if (!loginResult || !loginResult.code) {
    throw new Error('微信登录凭证获取失败，请重试。')
  }

  return loginResult.code
}

async function anonymousGraphql(query, variables) {
  const result = await request({
    url: config.GRAPHQL_URL,
    data: { query, variables }
  })

  if (result.errors && result.errors.length) {
    throw new Error(result.errors[0].message || 'Zion 请求失败。')
  }

  return result.data
}

async function signInWithWechat(phoneCode) {
  if (typeof phoneCode !== 'string' || !phoneCode.trim()) throw new Error('请先授权手机号。')
  const generation = sessionGeneration
  const previousToken = getStoredToken()
  // A provisional WeChat token never becomes a persisted application session.
  const token = await obtainWechatRuntimeToken()
  const binding = await invokePhoneFlow(token, config.ACTION_FLOWS.BIND_WECHAT_PHONE, { phone_code: phoneCode })
  if (!binding || binding.phoneVerified !== true) throw new Error('手机号绑定未完成，请重新授权。')
  await verifyPhoneToken(token)
  if (sessionGeneration !== generation || getStoredToken() !== previousToken) throw createAuthenticationRequiredError()
  wx.setStorageSync(TOKEN_KEY, token)
  verifiedPhoneToken = token
  authRedirectInProgress = false
  const user = await loadCurrentUser()
  if (sessionGeneration !== generation || getStoredToken() !== token) throw createAuthenticationRequiredError()
  return { ...user, phoneVerified: true }
}

async function obtainWechatRuntimeToken() {
  const code = await getWechatLoginCode()
  const data = await anonymousGraphql(
    `mutation LoginWithWechatMiniApp($code: String!) {
      loginWithWechatMiniApp(
        code: $code
        createIfNotExists: true
        matchAccountAcrossPlatforms: true
      ) {
        jwt { token }
      }
    }`,
    { code }
  )

  const token = data && data.loginWithWechatMiniApp && data.loginWithWechatMiniApp.jwt && data.loginWithWechatMiniApp.jwt.token
  if (!token) {
    throw new Error('微信登录未返回有效凭证，请检查 Zion 的微信小程序配置。')
  }

  return token
}

async function renewWechatRuntimeToken() {
  const previousToken = getStoredToken()
  const generation = sessionGeneration
  const token = await obtainWechatRuntimeToken()
  await verifyPhoneToken(token)
  if (sessionGeneration !== generation || getStoredToken() !== previousToken) throw createAuthenticationRequiredError()
  wx.setStorageSync(TOKEN_KEY, token)
  verifiedPhoneToken = token
  return token
}

async function getRuntimeToken() {
  const storedToken = getStoredToken()
  if (!storedToken) {
    throw requireAuthentication()
  }
  if (verifiedPhoneToken !== storedToken) {
    if (!phoneVerificationFlight || phoneVerificationFlight.token !== storedToken) {
      const promise = verifyPhoneToken(storedToken).catch(async error => {
        if (getStoredToken() !== storedToken) throw createAuthenticationRequiredError()
        if (error.code === 'PHONE_REQUIRED') throw requirePhoneAuthorization()
        if (error.code === 'AUTH_REQUIRED') {
          try { return await renewWechatRuntimeToken() } catch (renewError) {
            if (getStoredToken() !== storedToken) throw createAuthenticationRequiredError()
            if (renewError.code === 'PHONE_REQUIRED') throw requirePhoneAuthorization()
            throw requireAuthentication()
          }
        }
        throw error
      })
      phoneVerificationFlight = { token: storedToken, promise }
    }
    const flight = phoneVerificationFlight
    try {
      await flight.promise
      const current = getStoredToken()
      if (!current || (current !== storedToken && verifiedPhoneToken !== current)) throw createAuthenticationRequiredError()
      verifiedPhoneToken = current
    } finally { if (phoneVerificationFlight === flight) phoneVerificationFlight = null }
  }
  return getStoredToken()
}

async function graphql(query, variables, { retriedAfterTokenRefresh = false, timeout, expectedToken } = {}) {
  const token = await getRuntimeToken()
  if (expectedToken && token !== expectedToken) throw new Error('登录账号已变化，请重新进入个人资料。')
  const result = await request({
    url: config.GRAPHQL_URL,
    data: { query, variables },
    header: { Authorization: `Bearer ${token}` },
    timeout
  })

  if (getStoredToken() !== token) throw new Error('登录账号已变化，请重新进入。')

  if (result.errors && result.errors.length) {
    const message = result.errors[0].message || 'Zion 请求失败。'
    if (isRuntimeTokenRejection(message)) {
      // Zion can reject a just-issued token while the mini-program binding is
      // propagating. Renew it through wx.login and retry this exact request
      // once before treating the session as genuinely expired.
      if (!retriedAfterTokenRefresh && !expectedToken) {
        try {
          await renewWechatRuntimeToken()
          return graphql(query, variables, { retriedAfterTokenRefresh: true, timeout })
        } catch (refreshError) {
          if (getStoredToken() !== token) throw createAuthenticationRequiredError()
          if (refreshError.code === 'PHONE_REQUIRED') throw requirePhoneAuthorization()
          // The original rejection remains the user-facing authentication
          // result; the refresh failure may contain platform-only details.
        }
      }
      throw requireAuthentication()
    }
    throw new Error(message)
  }

  return result.data
}

async function invokeActionFlow(flow, args = {}, { timeout, expectedToken } = {}) {
  const operation = Number.isInteger(flow.versionId)
    ? `fz_invoke_action_flow(actionFlowId: "${flow.id}", versionId: ${flow.versionId}, args: $args)`
    : `fz_invoke_action_flow_default_by_latest_version(actionFlowId: "${flow.id}", args: $args)`
  const data = await graphql(
    `mutation InvokeActionFlow($args: Json!) {
      result: ${operation}
    }`,
    { args },
    { timeout, expectedToken }
  )
  return parseActionFlowResult(data.result)
}

// 兑换码页先问后端：输入的是不是「重置测试账号」的开启码（2026-09-28 用户规则）。
// 以游客身份调用、不带登录凭证：后端还是旧版本时，旧代码对游客一律报 DEV_RESET_FORBIDDEN，不会误重开当前账号。
// 是开启码就在本机记住并返回 true；不是、或这一步出错都返回 false，兑换码照常走兑换。
async function unlockDevelopmentReset(code) {
  const normalized = String(code || '').trim().toUpperCase()
  if (!/^[A-Z0-9-]{4,64}$/.test(normalized)) return false
  try {
    const response = await request({
      url: config.GRAPHQL_URL,
      data: {
        query: `mutation CheckDevelopmentResetCode($args: Json!) { result: fz_invoke_action_flow_default_by_latest_version(actionFlowId: "${config.ACTION_FLOWS.RESET_DEVELOPMENT_ACCOUNT.id}", args: $args) }`,
        variables: { args: { payload: { operation: 'check', code: normalized } } }
      },
      timeout: 8000
    })
    if (response.errors && response.errors.length) return false
    const result = parseActionFlowResult(response.data && response.data.result)
    if (!result || result.status !== 'unlocked') return false
  } catch (error) {
    return false
  }
  rememberDevResetCode(normalized)
  return true
}

async function resetDevelopmentAccount() {
  // 按钮只在本机开启后才显示；没有开启码说明开关被清掉了，不去打扰后端
  const code = readDevResetCode()
  if (!code) throw new Error('DEV_RESET_LOCKED')
  let result
  try {
    result = await invokeActionFlow(config.ACTION_FLOWS.RESET_DEVELOPMENT_ACCOUNT, { payload: { operation: 'reset', code } }, { timeout: 20000 })
  } catch (error) {
    // 后端换了开启码：本机记的码作废，按钮随之消失，要在兑换码页重新输入
    if (/DEV_RESET_FORBIDDEN/.test(String(error && error.message || ''))) forgetDevResetCode()
    throw error
  }
  if (!result || result.status !== 'reopened') throw new Error('开发账号重开未完成，请稍后重试。')

  sessionGeneration += 1
  resetPhoneSessionVerification()
  authRedirectInProgress = false
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) app.globalData.user = null
  }
  wx.clearStorageSync()
  // 清的是本地会话，不是开关：重新登录后这台手机照样能接着重置
  rememberDevResetCode(code)
  return result
}

function validMembershipTier(tier) {
  return !!tier && typeof tier.name === 'string' && tier.name.length > 0 && Number(tier.amount) > 0 && Number(tier.creditAmount) >= 0
}

// productVersionId is only a choice among published tiers; price, credits and eligibility are decided by the server.
async function membershipRequest(create = false, productVersionId = '') {
  const token = await getRuntimeToken()
  if (create && !/^[1-9][0-9]*$/.test(String(productVersionId))) throw new Error('请先选择会员等级。')
  let result
  try {
    result = await invokeActionFlow(create ? config.ACTION_FLOWS.CREATE_MEMBERSHIP_ORDER : config.ACTION_FLOWS.GET_CURRENT_MEMBERSHIP,
      create ? { productVersionId: String(productVersionId) } : {}, { timeout: 20000, expectedToken: token })
  } catch (error) {
    if (isAuthenticationRequired(error)) throw error
    const messages = { MEMBERSHIP_PROFILE_REQUIRED: '请先完成手机号登录和学习档案。', MEMBERSHIP_ORDER_CHANGED: '会员订单已变化，请重新查询。',
      MEMBERSHIP_ALREADY_ACTIVE: '你已是会员，无需再次开通，可购买积分包补充积分。', MEMBERSHIP_TIER_UNAVAILABLE: '该会员等级已下架或价格已更新，请刷新后重新选择。',
      MEMBERSHIP_TIER_NOT_HIGHER: '只能升级到比当前更高的会员等级，请刷新后重新选择。',
      MEMBERSHIP_INVITE_REQUIRED: '开通会员需要先填写邀请码。',
      // 支付开关关着（管理端「活动开关 → 会员与积分包支付」），后端拒绝下单
      PAYMENT_DISABLED: paymentClosedMessage('membership') }
    const key = Object.keys(messages).find(key => String(error.message).includes(key))
    // code 让会员中心分辨「需要先填邀请码」，直接弹出填码框
    throw Object.assign(new Error(key ? messages[key] : '会员状态暂时无法确认，请稍后重新查询。'), { code: key || '' })
  }
  if (getStoredToken() !== token) throw new Error('账号已变化，请重新打开会员页面。')
  if (!result || typeof result.eligible !== 'boolean' || !['active', 'inactive', 'expired', 'pending', 'refunded', 'closed'].includes(result.status)
    || !Array.isArray(result.tiers) || !result.tiers.every(tier => validMembershipTier(tier) && /^[1-9][0-9]*$/.test(String(tier.productVersionId)))
    || (result.tier && !validMembershipTier(result.tier))
    || (result.order && (!/^[1-9][0-9]*$/.test(String(result.order.orderId)) || !(Number(result.order.amount) > 0)))
    || (result.pendingOrder && (!/^[1-9][0-9]*$/.test(String(result.pendingOrder.orderId)) || !(Number(result.pendingOrder.amount) > 0)))
    || (result.eligible && (!result.tier || (result.permanent !== true && !Number.isFinite(Date.parse(result.expiresAt)))))) {
    throw new Error('会员信息暂不可用，请重新查询。')
  }
  // pendingOrder：会员升级时那笔还在待支付的订单（后端 2026-09-24 起返回；旧版后端没有，非会员时 order 就是它）。
  return { ...result, order: result.order ? { ...result.order, statusLabel: orderStatusLabel(result.order.status) } : result.order,
    pendingOrder: result.pendingOrder ? { ...result.pendingOrder, statusLabel: orderStatusLabel(result.pendingOrder.status) } : null }
}

async function loadCurrentMembership() { return membershipRequest(false) }
async function createMembershipOrder(productVersionId) { return membershipRequest(true, productVersionId) }

function coursePortalOrigin() {
  const value = String(config.COURSE_PORTAL_ORIGIN || '').replace(/\/$/, '')
  if (!/^https:\/\/[^/]+$/i.test(value)) {
    throw new Error('课程站点尚未配置。')
  }
  return value
}

async function issueLearningEntry(courseInstanceId, targetScene, acceptanceId) {
  const token = await getRuntimeToken()
  const origin = coursePortalOrigin()
  const data = await request({
    url: `${origin}/api/course-launch/issue`,
    data: { courseInstanceId, targetScene, ...(acceptanceId ? { acceptanceId } : {}) },
    header: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    timeout: 20000,
    timeoutMessage: '课程服务响应超时，请稍后重试。'
  })
  const url = data && data.launchUrl
  const prefix = `${origin}/launch?token=`
  if (typeof url !== 'string' || !url.startsWith(prefix) || !/^[A-Za-z0-9_-]{32,512}$/.test(url.slice(prefix.length))) {
    throw new Error('课程入口无效，请稍后重试。')
  }
  return url
}

// 小程序内打开课程：用当前登录向课程服务换一次性入场券（60 秒、单次有效），web-view 打开即完成鉴权。
// 课程只能从小程序进入（2026-09-27 起没有「学习设备确认」）：换不到入场券就在课程页报错重试，
// 不打开不带凭证的课程地址——那样只会看到「请从小程序进入课程」。
const COURSE_ENTRY_ERRORS = {
  LOGIN_REQUIRED: '登录已过期，请重新登录后进入课程。',
  // 免费体验只开放前 3 节，后面的课开会员解锁（2026-11-11）；会员课程库也报这个码
  MEMBERSHIP_REQUIRED: '这节课要开通会员才能学：免费体验开放前 3 节课。',
  COURSE_ACCESS_DENIED: '当前学习账号暂不可访问这门课程。',
  // 系列课按顺序学（2026-10-15）：课程服务 lib/course/agent-course-order.ts
  COURSE_LOCKED: '闯关要一关一关过：上一节的看课、互动练习和验收都过了，这一节才会解锁。',
  TRY_LATER: '操作过于频繁，请稍后重试。'
}

async function createLearnerEntryUrl(reference, query) {
  const { statusCode, data } = await requestCourseApi('/api/learn/device', {
    method: 'POST', data: { operation: 'handoff', ...reference }, timeout: 15000
  })
  const ticket = data.ticket
  if (statusCode !== 200 || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) {
    throw new Error(COURSE_ENTRY_ERRORS[data.code] || '课程入口暂时不可用，请稍后重试。')
  }
  return `${coursePortalOrigin()}/api/learn/entry?${query}&layout=focus&ticket=${ticket}`
}

async function createCourseLaunchUrl(courseInstanceId) {
  const normalizedCourseInstanceId = Number(courseInstanceId)
  if (!Number.isSafeInteger(normalizedCourseInstanceId) || normalizedCourseInstanceId <= 0) {
    throw new Error('课程信息不完整，请刷新后重试。')
  }
  return createLearnerEntryUrl({ courseInstanceId: normalizedCourseInstanceId }, `course=${normalizedCourseInstanceId}`)
}

// sceneId：课程详情页点了某一页，课程服务从这一页开始（/learn?scene=）；不带时按学习进度续学。
async function createAgentCourseLaunchUrl(stageId, sceneId = '') {
  if (!isAgentCourseId(stageId)) throw new Error('课程信息不完整，请刷新后重试。')
  const scene = /^[A-Za-z0-9_-]{1,80}$/.test(String(sceneId || '')) ? `&scene=${sceneId}` : ''
  return createLearnerEntryUrl({ agentCourseId: stageId }, `agent=${stageId}${scene}`)
}

// 智能体课程接口同时带登录态与智能体的匿名身份：后者用于把这台设备上刚生成的课程
// 绑定到当前学习者（见课程服务 lib/course/agent-course-access.ts）。
function requestAgentCourses(path, token, options = {}) {
  const { readAgentCookieHeader } = require('./course-agent-service')
  const header = { authorization: `Bearer ${token}` }
  const cookie = readAgentCookieHeader()
  if (cookie) header.Cookie = cookie
  if (options.data) header['content-type'] = 'application/json'
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}${path}`, method: options.method || 'GET', timeout: options.timeout || 15000, header,
    ...(options.data ? { data: options.data } : {}),
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请重新打开课程。'))
      if (response.statusCode === 200 && response.data) return resolve(response.data)
      const messages = {
        LOGIN_REQUIRED: '请重新登录后查看课程。',
        AGENT_COURSE_NOT_FOUND: '没有找到这门课程，可能还没有开始生成。',
        COURSE_ACCESS_DENIED: '当前学习账号暂不可访问这门课程。',
        COURSE_NOT_FINISHED: '这门课还没学完，学完全部内容后再来验收。',
        // 测试快捷方式「标记学完，去验收」（课程服务核对「重置测试账号」开启码）
        DEV_RESET_FORBIDDEN: '开启码已失效，请到「我的 → 兑换码」重新输入。',
        COURSE_LOCKED: '闯关要一关一关过：先把上一节的三关都过了。',
        MEMBERSHIP_REQUIRED: '这节课要开通会员才能学：免费体验开放前 3 节课。',
        DEV_RESET_UNAVAILABLE: '暂时核对不了开启码，请稍后重试。',
        NOTHING_TO_LEARN: '这门课没有需要学的讲解页，不能验收。',
        ACCEPTANCE_NOT_STARTED: '验收已结束，请重新开始验收。',
        ACCEPTANCE_TOO_MANY_TURNS: '这次验收的回答次数已用完，请刷新查看结果。',
        ACCEPTANCE_NOT_PENDING: '这门课已经核验过了，请刷新查看最新状态。',
        NOT_TEACHER: '当前账号不是在职老师，无法核验。',
        STUDENT_NOT_BOUND: '这位学生不在你的负责名单里。',
        SUMMARY_REQUIRED: '请写一句需要重学的原因，学生会看到。',
        // 学习安排（课程服务 lib/course/study-plan.ts）
        PLAN_CHANGED: '学习安排刚被更新过，已刷新到最新，请再操作一次。',
        PLAN_NOT_FOUND: '还没有学习安排，先选每天学习时长并自动排课。',
        NOTHING_TO_SCHEDULE: '没有需要安排的课程：课程都学完了，或者还在生成中。',
        NOTHING_TO_ADD: '这门课没学的部分都已经排进安排了。',
        TASK_NOT_FOUND: '这条任务已经不在安排里了，请刷新后再试。',
        COURSE_NOT_READY: '这门课还没生成好，生成好后才能排进安排。',
        DAY_INVALID: '请选择今天或以后的日期。',
        DAILY_MINUTES_INVALID: '请从 15 分钟到 2 小时里选一个每天学习时长。',
        STUDY_WEEKDAYS_INVALID: '每周至少选一天学习。',
        REST_DAYS_INVALID: '休息日要选今天起 90 天内的日期，最多 60 天。',
        // 老师工作台「没完成任务」与催学的话（课程服务 lib/course/study-reminder.ts）
        NOTHING_MISSED: '这位学生没有没学完的任务了。',
        REMINDER_NOTE_FAILED: '这段话没有写好，请再点一次生成。',
        STUDY_REMINDER_UNAVAILABLE: '没完成的任务暂时读不到，请稍后重试。',
        STUDY_PLAN_UNAVAILABLE: '学习安排暂时无法读取，请稍后重试。',
        // 学习偏好（课程服务 lib/course/learning-preference.ts）
        PREFERENCE_TOO_MANY: '这一组选得太多了，去掉几个再保存。',
        PREFERENCE_INVALID: '学习偏好的内容不对，请刷新后重新选择。',
        NOTE_TOO_LONG: '补充说明太长了，删减一些再保存。',
        LEARNING_PREFERENCE_UNAVAILABLE: '学习偏好暂时无法读取，请稍后重试。',
        // 学习目标（课程服务 lib/course/learning-goal.ts）
        GOAL_INVALID: '学习目标的内容不对，请刷新后重新填写。',
        GOAL_TOO_LONG: '具体目标写得太长了，删减一些再保存。',
        GOAL_DEADLINE_INVALID: '完成时间要选今天或以后的日期。',
        LEARNING_GOAL_UNAVAILABLE: '学习目标暂时无法读取，请稍后重试。',
        // 间隔复习小测（课程服务 lib/course/review-service.ts）
        REVIEW_NOT_DUE: '这节课还没到复习的日子。',
        REVIEW_NOT_FOUND: '这节课学完以后才会安排复习。',
        REVIEW_NOT_STARTED: '今天的复习还没开始，请重新打开复习。',
        ANSWERS_INVALID: '回答没有对上题目，请重新打开复习再答一遍。',
        REVIEW_UNAVAILABLE: '复习暂时无法打开，请稍后重试。',
        // 课后作业（课程服务 lib/course/homework）
        HOMEWORK_NOT_FOUND: '这节课还没有课后作业，学完整节课后才会出题。',
        HOMEWORK_NOT_READY: '练习题还没出好，请稍后再来做。',
        // 代理绑定家庭、身份申请（课程服务 lib/agent-roles，2026-11-10）
        INVALID_PUBLIC_ID: '请输入正确的用户 ID（「我的」页头像下方的数字）。',
        USER_NOT_FOUND: '没有找到这个用户，请核对用户 ID。',
        NOT_GUARDIAN: '请输入家长的用户 ID：这个账号是学生账号。',
        OWN_FAMILY: '不能绑定自己家。',
        FAMILY_ALREADY_BOUND: '这个家庭已经被别的代理绑定了。',
        FAMILY_ALREADY_MINE: '这个家庭你已经绑定过了。',
        NOT_BINDING_AGENT: '开通爱心妈妈或团长身份后才能绑定家庭。',
        NOT_TEAM_LEADER: '只有爱心妈妈团团长能替别人申请。',
        TEAM_SELF: '不能替自己申请，请在申请页自己提交。',
        AGENT_IN_TEAM: '对方已经在别的团里了。',
        ROLES_ALREADY_HELD: '勾选的身份都已经开通了。',
        APPLICATION_PENDING: '已经有一份申请在审核中，请等审核结果。',
        VERIFICATION_REQUIRED: '请先完成实名认证再申请。',
        INVALID_PHONE: '请输入正确的 11 位手机号。',
        AGENT_ROLES_REQUIRED: '请至少选择一个身份。',
        AGENT_SERVICE_UNAVAILABLE: '代理服务暂时不可用，请稍后重试。',
        // 代理带来的新家庭的免费体验（课程服务 lib/agent-trial，2026-11-11）
        FAMILY_NOT_MINE: '这个家庭不是你绑定的。',
        CHILD_NOT_IN_FAMILY: '这个孩子不在这个家庭里，请刷新后重试。',
        TRIAL_TEST_USED: '这个家庭的免费测评已经开始测了，不能再换孩子。',
        TRIAL_TEST_NOT_DONE: '孩子测完以后才有报告和话术。',
        SCRIPT_UNAVAILABLE: '话术没有写好，请再点一次。',
        MEETING_NOTE_REQUIRED: '请写一下方便的时间和想解决的问题。',
        TRIAL_MEETING_USED: '这个家庭已经申请过免费诊断会议了。',
        // 闯关学习（课程服务 lib/course/homework/practice.ts、quest-path.ts，2026-11-11）
        PRACTICE_REQUIRED: '先把这节课的互动练习闯过去，再来找老师验收。',
        PRACTICE_STALE: '这道题已经答过了，正在刷新。',
        PRACTICE_DONE: '这节课的互动练习已经通关了。',
        PRACTICE_NOT_FOUND: '互动练习还没准备好，请稍后再试。',
        QUEST_PATH_UNAVAILABLE: '学习路径暂时无法读取，请稍后重试。',
        CHEST_LOCKED: '先把这节课看完，宝箱就能打开了。',
        CHEST_UNAVAILABLE: '宝箱暂时打不开，请稍后再试。',
        CHOICES_INVALID: '答案没有对上题目，请刷新后再交一次。',
        HOMEWORK_UNAVAILABLE: '课后作业暂时无法读取，请稍后重试。',
        STUDENT_INVALID: '孩子信息不完整，请刷新后重试。',
        // 家长学习成长报告（课程服务 lib/parent-report）
        REPORT_NOT_FOUND: '这份报告找不到了，请刷新后重试。',
        REPORT_NOT_READY: '报告还在生成，请稍后再试。',
        REPORT_FILE_MISSING: '这份报告的文件已经不在了，请重新生成。',
        REPORT_BUSY: '这份报告还在生成，生成好后才能删除。',
        PARENT_REPORT_UNAVAILABLE: '报告暂时无法读取，请稍后重试。',
        // 推送家长（课程服务 lib/mp-notice/event-service.ts）
        NO_GUARDIAN: '这位学生还没有绑定家长，家长绑定后才能推送。',
        PUSH_UNAVAILABLE: '服务号推送暂时用不了，可以先用「发给家长」发文件。',
        PUSH_DISABLED: '服务号推送已在后台关闭，可以先用「发给家长」发文件。',
        ZION_UNAVAILABLE: '学生的家长信息暂时读不到，请稍后重试。',
        // 老师「今日学习」与每天发给学生的话（课程服务 lib/daily-learning）
        DAILY_NOT_STUDIED: '学生今天还没有学习记录，学了之后再生成。',
        DAILY_NOTE_FAILED: '这段话没有写好，请再点一次生成。',
        DAILY_OVERVIEW_UNAVAILABLE: '孩子的测评和课程记录暂时读不到，请稍后再生成。',
        DAILY_LEARNING_UNAVAILABLE: '今日学习暂时无法读取，请稍后重试。',
        // 家长给没有微信的孩子建网页端账号（课程服务 lib/portal/child-accounts.ts）
        GUARDIAN_VERIFICATION_REQUIRED: '请先完成实名认证，再给孩子创建网页端账号。',
        GUARDIAN_AGE_UNKNOWN: '实名信息里没有出生日期，请重新提交一次实名认证。',
        GUARDIAN_UNDERAGE: '年满 22 周岁的家长才能给孩子创建账号。',
        PROFILE_REQUIRED: '请先完善你的资料。',
        TOO_MANY_CHILDREN: '每位家长最多给 5 个孩子创建网页端账号。',
        PROVIDER_LIMIT_REACHED: '已达到可绑定孩子的上限，需要更多名额请联系知鹿调整。',
        CHILD_NAME_INVALID: '请填写孩子的称呼（20 个字以内）。',
        CHILD_GRADE_INVALID: '请选择孩子的年级。',
        CHILD_SEMESTER_INVALID: '请选择上学期或下学期。',
        CHILD_TEXTBOOK_INVALID: '请选择孩子用的教材版本。',
        CHILD_PROFILE_INVALID: '孩子的资料不完整，请检查后再提交。',
        CHILD_SCHOOL_INVALID: '请填写孩子就读的学校。',
        CHILD_REGION_INVALID: '请填写孩子所在的城市。',
        CHILD_NOT_FOUND: '没有找到这个孩子，请刷新后重试。',
        CHILD_NOT_READY: '这个孩子的账号还没创建完成，请重新创建一次。',
        PASSWORD_REQUIRED: '请设置登录密码。',
        PASSWORD_LENGTH: '密码要 8～64 位。',
        PASSWORD_TOO_SIMPLE: '密码要同时包含字母和数字。',
        PASSWORD_WHITESPACE: '密码里不能有空格。',
        REQUEST_KEY_INVALID: '请重新打开本页后再试。',
        CHILD_SERVICE_UNAVAILABLE: '孩子账号服务暂时不可用，请稍后重试。',
        // 按目标测评（课程服务 lib/goal-diagnosis）
        GOAL_REQUIRED: '先定一个学习目标，再围绕它测评。',
        SUBJECT_REQUIRED: '这个目标是哪一门学科的？选一门再开始。',
        DIAGNOSIS_NOT_FOUND: '没有找到这次测评，请刷新后重试。',
        CHOICE_INVALID: '请先选一个答案。',
        QUESTION_UNAVAILABLE: '这道题暂时读不到，请刷新后重试。',
        KNOWLEDGE_UNAVAILABLE: '知识图谱暂时读不到，请稍后重试。',
        GOAL_DIAGNOSIS_UNAVAILABLE: '测评暂时无法打开，请稍后重试。',
        // 个人收货地址（课程服务 lib/shipping-address）
        ADDRESS_INCOMPLETE: '收货地址不完整，请在微信里补全收件人、电话和详细地址后再选。',
        PHONE_INVALID: '收货地址里的手机号不对，请在微信里改一下再选。'
      }
      const code = response.data && response.data.code
      const error = new Error(messages[code] || options.fallbackMessage || '课程进度暂时无法读取，请稍后重试。')
      error.code = code
      error.statusCode = response.statusCode
      reject(error)
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

// 智能体课程验收（课程服务 lib/course/agent-acceptance.ts）：学完 → 与验收智能体对话 → AI 通过后等老师核验。
function assertStageId(stageId) {
  if (!isAgentCourseId(stageId)) throw new Error('课程链接无效，请回到「我的课程」重新打开。')
}

async function loadAgentCourseAcceptance(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  // practiceFirst（闯关学习，2026-11-11）：附上互动练习通关没有；没通关时验收页先引导去做练习
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/acceptance?practiceFirst=1`, token, { fallbackMessage: '验收状态暂时无法读取，请稍后重试。' })
}

/** message 为空：开始或继续验收（验收智能体先提问）。回答要等模型，超时放宽到 60 秒。 */
async function sendAgentCourseAcceptance(stageId, message = '') {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/acceptance`, token, {
    method: 'POST', data: { message: String(message || ''), practiceFirst: true }, timeout: 60000, fallbackMessage: '验收暂时无法继续，请稍后重试。'
  })
}

/** 间隔复习小测（课程服务 lib/course/review-service.ts）：到期时出题，今天做过返回结果。出题要等模型。 */
async function loadAgentCourseReview(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/review`, token, {
    timeout: 60000, fallbackMessage: '复习暂时无法打开，请稍后重试。'
  })
}

/** 先看一眼这句是不是在答第 index 题（不记录）：{ kind, accepted, reply }。 */
async function checkAgentCourseReviewAnswer(stageId, index, answer) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  const data = await requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/review`, token, {
    method: 'POST', data: { action: 'check', index: Number(index) || 0, answer: String(answer || '') }, timeout: 20000, fallbackMessage: '回答暂时没有发出去，请再发一次。'
  })
  return data && data.check || { accepted: true, kind: 'answer', reply: '' }
}

/** 交卷：answers 与题目一一对应；判分要等模型，超时放宽到 60 秒。 */
async function submitAgentCourseReview(stageId, answers) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/review`, token, {
    method: 'POST', data: { answers: (answers || []).map((answer) => String(answer || '')) }, timeout: 60000, fallbackMessage: '没有交上去，请再发一次。'
  })
}

/**
 * 课后作业（课程服务 lib/course/homework，2026-10-13）：整节学完后后台出 3～5 道练习题。
 * 返回 { homework: { status: locked / preparing / ready / failed / done, questions, result } }；交卷前不带答案。
 */
async function loadAgentCourseHomework(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework`, token, {
    timeout: 20000, fallbackMessage: '课后作业暂时无法读取，请稍后重试。'
  })
}

/** 交卷：choices 与题目一一对应（'A'～'D'），服务端判分后返回带结果与解析的作业。 */
async function submitAgentCourseHomework(stageId, choices) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework`, token, {
    method: 'POST', data: { choices: (choices || []).map((choice) => String(choice || '')) }, timeout: 20000, fallbackMessage: '没有交上去，请再交一次。'
  })
}

/** 出题失败时重新出题。 */
async function retryAgentCourseHomework(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework`, token, {
    method: 'POST', data: { action: 'retry' }, timeout: 20000, fallbackMessage: '没有重新出题，请稍后再试。'
  })
}

/**
 * 互动练习（闯关学习第二关，课程服务 lib/course/homework/practice.ts，2026-11-11）：
 * 返回 { practice: { kind, status: locked / preparing / ready / failed / done, questions, progress, review } }。
 * 一屏一道：answerAgentCoursePractice 答当前这道，返回 { correct, answer, explanation, feedback, hint, held, practice }。
 */
async function loadAgentCoursePractice(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework?practice=1`, token, {
    timeout: 20000, fallbackMessage: '互动练习暂时无法读取，请稍后重试。'
  })
}

async function answerAgentCoursePractice(stageId, index, response) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework?practice=1`, token, {
    // coach：第一次答错先不给答案，只给错在哪和提示（2026-11-12 错项针对性反馈）
    method: 'POST', data: { action: 'answer', index: Number(index), response, coach: true }, timeout: 20000, fallbackMessage: '没有提交上去，请再点一次。'
  })
}

async function retryAgentCoursePractice(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/homework?practice=1`, token, {
    method: 'POST', data: { action: 'retry' }, timeout: 20000, fallbackMessage: '没有重新出题，请稍后再试。'
  })
}

/** 学习页闯关路径（课程服务 /api/learn/quest-path）：{ path: { goal, stages, current, stats } }。 */
async function loadQuestPath() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/quest-path', token, { timeout: 20000, fallbackMessage: '学习路径暂时无法读取，请稍后重试。' })
  const path = data && data.path
  // 荣誉（2026-11-11 晚）随路径一起回来；旧版课程服务没有
  if (path && typeof path === 'object' && data.honors) path.honors = data.honors
  return path
}

/**
 * 我的荣誉（课程服务 /api/learn/honors，2026-11-11 晚）：{ summary, trophies, badges, medals }。
 * 学习页的闯关路径回包里也带一份（loadQuestPath 返回的 path.honors），用来显示顶栏数字和「新获得」。
 */
async function loadHonors() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/honors', token, { timeout: 20000, fallbackMessage: '荣誉暂时读不到，请稍后重试。' })
  return data && data.honors
}

/**
 * 打开闯关路径上一节课的宝箱（课程服务 /api/learn/quest-chest）。
 * 带 coinReward: true 表示这一版认得金币奖励（2026-11-11）：
 * { kind: 'draws' | 'coins', draws, coins, alreadyOpened, bonusDraws, coinsToday, coinCap }。
 */
async function openQuestChest(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/quest-chest', token, {
    method: 'POST', data: { stageId, coinReward: true }, timeout: 20000, fallbackMessage: '宝箱暂时打不开，请稍后再试。'
  })
}

/** 家长学生看板「作业动态」：一个绑定孩子最近 60 天的课后作业（课程服务按家长绑定校验）。 */
async function loadGuardianHomework(studentProfileId) {
  const id = String(studentProfileId || '')
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('孩子信息不完整，请刷新后重试。')
  const token = await getRuntimeToken()
  const data = await requestAgentCourses(`/api/learn/guardian-homework?studentProfileId=${id}`, token, {
    timeout: 20000, fallbackMessage: '课后作业暂时无法读取，请稍后重试。'
  })
  return Array.isArray(data && data.homework) ? data.homework : []
}

/**
 * 测试快捷方式「标记学完，去验收」（2026-10-03 用户要求）：只在输入过「重置测试账号」开启码的手机上出现。
 * 带上本机记住的开启码，课程服务找后端再核一遍，再把这门课每一页记成学完；开启码失效时清掉本机开关。
 */
async function finishAgentCourseForTest(stageId) {
  assertStageId(stageId)
  const code = readDevResetCode()
  if (!code) throw new Error('请先在「我的 → 兑换码」输入开启码。')
  const token = await getRuntimeToken()
  try {
    return await requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}/test-finish`, token, {
      method: 'POST', data: { code }, timeout: 30000, fallbackMessage: '没有标记成功，请稍后重试。'
    })
  } catch (error) {
    if (error && error.code === 'DEV_RESET_FORBIDDEN') forgetDevResetCode()
    throw error
  }
}

/** 老师端：负责学生的智能体课程、学习进度与验收状态。 */
async function loadTeacherStudentAgentCourses(studentProfileId) {
  const id = String(studentProfileId || '')
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('学生信息不完整，请返回重试。')
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/agent-courses?studentProfileId=${id}`, token, { fallbackMessage: '学生课程暂时无法读取，请稍后重试。' })
}

async function loadTeacherAgentAcceptance(stageId) {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/agent-courses/${encodeURIComponent(stageId)}/acceptance`, token, { fallbackMessage: '验收记录暂时无法读取，请稍后重试。' })
}

/** result: passed（确认验收，知识点写进学生宇宙）/ remediation（需要重学，summary 必填）。 */
async function reviewAgentCourseAcceptance(stageId, result, summary = '') {
  assertStageId(stageId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/agent-courses/${encodeURIComponent(stageId)}/acceptance`, token, {
    method: 'POST', data: { result, summary: String(summary || '') }, timeout: 30000, fallbackMessage: '核验没有提交成功，请稍后重试。'
  })
}

/**
 * 老师端「学习安排」（课程服务 lib/course/study-plan.ts）：每天学习时长、按天的学习任务与每门课的学习情况。
 * 身份与负责关系由课程服务按老师自己的登录态校验，studentProfileId 只是目标。
 */
async function loadTeacherStudyPlan(studentProfileId) {
  const id = String(studentProfileId || '')
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('学生信息不完整，请返回重试。')
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/study-plan?studentProfileId=${id}`, token, { fallbackMessage: '学习安排暂时无法读取，请稍后重试。' })
}

/**
 * 修改学习安排。change：
 *   { action: 'auto', dailyMinutes, startDay, studyWeekdays?, restDays? }（自动排课，要等模型判断难度，超时放宽到 60 秒；
 *     studyWeekdays 是 1–7（周一到周日）的学习日，restDays 是单独的休息日，不传沿用上次的）
 *   { action: 'move', taskId, day } / { action: 'remove', taskId } / { action: 'add', stageId, day } / { action: 'clear' }
 * revision 是页面读到的版本号，期间被别人改过时课程服务返回 PLAN_CHANGED。
 */
async function updateTeacherStudyPlan(studentProfileId, revision, change = {}) {
  const id = String(studentProfileId || '')
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('学生信息不完整，请返回重试。')
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/teacher/study-plan', token, {
    method: 'POST',
    data: { ...change, studentProfileId: id, revision: Number(revision) || 0 },
    timeout: change.action === 'auto' ? 60000 : 20000,
    fallbackMessage: '学习安排没有保存成功，请稍后重试。'
  })
}

// 老师工作台「没完成任务」（2026-10-09）：负责的学生里前几天学习任务没学完的，没学完的页已带到今天（今天休息就是下一个学习日）。
/** { today, alerts: [{ studentProfileId, taskCount, minutes, lastMissedDay, firstMissedDay, carryDay, titles }], failedCount } */
async function loadTeacherStudyAlerts() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/teacher/study-alerts', token, { timeout: 30000, fallbackMessage: '没完成任务的学生暂时读不到，请稍后重试。' })
  return {
    today: typeof data.today === 'string' ? data.today : '',
    failedCount: Number(data.failedCount) || 0,
    alerts: (Array.isArray(data.alerts) ? data.alerts : []).filter((item) => item && item.studentProfileId).map((item) => ({
      studentProfileId: String(item.studentProfileId),
      taskCount: Number(item.taskCount) || 0,
      minutes: Number(item.minutes) || 0,
      lastMissedDay: String(item.lastMissedDay || ''),
      firstMissedDay: String(item.firstMissedDay || ''),
      carryDay: String(item.carryDay || ''),
      titles: Array.isArray(item.titles) ? item.titles.map(String) : []
    }))
  }
}

/** 某个学生没学完的任务、已经带到哪天，以及老师今天生成的催学的话（没有为 null）。 */
async function loadTeacherStudyReminder(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/study-reminder?studentProfileId=${id}`, token, { timeout: 20000, fallbackMessage: '没完成的任务暂时读不到，请稍后重试。' })
}

/** 生成（或重新生成）今天催学的话；要等模型写，最多等一分钟。 */
async function createTeacherStudyReminder(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/teacher/study-reminder', token, {
    method: 'POST',
    data: { studentProfileId: id },
    timeout: 60000,
    fallbackMessage: '这段话暂时没有生成，请稍后重试。'
  })
}

// 家长学习成长报告（2026-10-06）：老师在学生详情里给学生出报告，课程服务后台生成并留档（lib/parent-report）。
function teacherStudentId(studentProfileId) {
  const id = String(studentProfileId || '')
  if (!/^[1-9][0-9]*$/.test(id)) throw new Error('学生信息不完整，请返回重试。')
  return id
}

/** 给这个学生出过的全部报告（新的在前），每份带状态、出报告的老师、寄语与摘要。 */
async function loadTeacherParentReports(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/parent-reports?studentProfileId=${id}`, token, { fallbackMessage: '报告记录暂时无法读取，请稍后重试。' })
}

/** 生成一份新报告：立即返回「生成中」的那一份；这个学生已有一份在生成就返回那一份。 */
async function createTeacherParentReport(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/teacher/parent-reports', token, {
    method: 'POST',
    data: { studentProfileId: id },
    fallbackMessage: '报告暂时无法生成，请稍后重试。'
  })
}

// 老师「学习情况 › 今日学习」（2026-10-07）：学生今天学了什么；今天学过的，生成一段发给学生的话（一天一段，可重新生成）。
/** 今天（北京时间）的学习事实，以及老师今天已经生成的那段话（没有为 null）。 */
async function loadTeacherDailyLearning(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/daily-learning?studentProfileId=${id}`, token, { timeout: 20000, fallbackMessage: '今日学习暂时无法读取，请稍后重试。' })
}

/** 按今天的学习生成（或重新生成）发给学生的话；要等模型写，最多等一分钟。 */
async function createTeacherDailyNote(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/teacher/daily-learning', token, {
    method: 'POST',
    data: { studentProfileId: id },
    timeout: 60000,
    fallbackMessage: '这段话暂时没有生成，请稍后重试。'
  })
}

/**
 * 下载一份报告的 PDF 到本地，返回本地文件路径（预览、发给家长都用它）。
 * course.zideer.cn 只在 request 合法域名里，不在 downloadFile 里：用 request 取二进制再写文件（同 AI 海报）。
 */
async function downloadTeacherParentReport(studentProfileId, reportId) {
  const id = teacherStudentId(studentProfileId)
  if (!/^[a-f0-9]{32}$/.test(String(reportId || ''))) throw new Error('报告信息不完整，请刷新后重试。')
  const token = await getRuntimeToken()
  const filePath = `${wx.env.USER_DATA_PATH}/parent-report-${reportId}.pdf`
  const data = await new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/teacher/parent-reports/${reportId}/file?studentProfileId=${id}`,
    method: 'GET',
    timeout: 60000,
    responseType: 'arraybuffer',
    header: { authorization: `Bearer ${token}` },
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('登录账号已变化，请重新打开页面。'))
      if (response.statusCode === 200 && response.data && response.data.byteLength > 64) return resolve(response.data)
      const messages = { 403: '这位学生不在你的负责名单里。', 404: '这份报告找不到了，请刷新后重试。', 409: '报告还在生成，请稍后再试。', 410: '这份报告的文件已经不在了，请重新生成。' }
      reject(new Error(messages[response.statusCode] || '报告暂时下载不了，请稍后重试。'))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath,
    data,
    success: resolve,
    fail: () => reject(new Error('报告没有保存到手机，请检查存储空间后重试。'))
  }))
  return filePath
}

/** 老师删除一份报告（2026-10-07）：删掉后老师、家长、服务号「学习报告」都看不到，留档仍在。 */
async function deleteTeacherParentReport(studentProfileId, reportId) {
  const id = teacherStudentId(studentProfileId)
  if (!/^[a-f0-9]{32}$/.test(String(reportId || ''))) throw new Error('报告信息不完整，请刷新后重试。')
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/parent-reports/${reportId}?studentProfileId=${id}`, token, {
    method: 'DELETE',
    fallbackMessage: '报告没有删除成功，请稍后重试。'
  })
}

/**
 * 老师「推送家长」（2026-10-08）：把一份已生成的报告推到学生绑定的每位家长的服务号（学生综合素质评价结果通知）。
 * 返回 { guardians, sent, waiting, failed }；同一份报告对同一位家长只推一次，再点只回结果。
 */
async function pushTeacherParentReport(studentProfileId, reportId) {
  const id = teacherStudentId(studentProfileId)
  if (!/^[a-f0-9]{32}$/.test(String(reportId || ''))) throw new Error('报告信息不完整，请刷新后重试。')
  const token = await getRuntimeToken()
  const data = await requestAgentCourses(`/api/teacher/parent-reports/${reportId}/push?studentProfileId=${id}`, token, {
    method: 'POST',
    data: {},
    timeout: 20000,
    fallbackMessage: '没有推送成功，请稍后重试。'
  })
  return data && data.push ? data.push : { guardians: 0, sent: 0, waiting: 0, failed: 0 }
}

/**
 * 家长「学习报告」（account/parent-reports，2026-10-07）：绑定的孩子，以及老师给他们出的、没删掉的报告（新的在前）。
 * 课程服务按登录账号现查家长绑定；顺带登记这个账号的微信 UnionID，服务号菜单「学习报告」据此认人。
 */
async function loadGuardianParentReports() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/parent-reports', token, { timeout: 20000, fallbackMessage: '学习报告暂时无法读取，请稍后重试。' })
  return {
    students: Array.isArray(data.students) ? data.students : [],
    reports: Array.isArray(data.reports) ? data.reports : []
  }
}

/** 家长下载一份报告 PDF 到本地，返回本地路径（同老师端：用 request 取二进制再写文件）。 */
async function downloadGuardianParentReport(reportId) {
  if (!/^[a-f0-9]{32}$/.test(String(reportId || ''))) throw new Error('报告信息不完整，请刷新后重试。')
  const token = await getRuntimeToken()
  const filePath = `${wx.env.USER_DATA_PATH}/learning-report-${reportId}.pdf`
  const data = await new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/parent-reports/${reportId}/file`,
    method: 'GET',
    timeout: 60000,
    responseType: 'arraybuffer',
    header: { authorization: `Bearer ${token}` },
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('登录账号已变化，请重新打开页面。'))
      if (response.statusCode === 200 && response.data && response.data.byteLength > 64) return resolve(response.data)
      const messages = { 401: '请重新登录后查看报告。', 404: '这份报告已被老师撤回，请刷新后查看。', 410: '这份报告的文件已经不在了，请联系老师重新出一份。' }
      reject(new Error(messages[response.statusCode] || '报告暂时下载不了，请稍后重试。'))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath,
    data,
    success: resolve,
    fail: () => reject(new Error('报告没有保存到手机，请检查存储空间后重试。'))
  }))
  return filePath
}

/**
 * 登记本账号的微信 UnionID（2026-10-07）：服务号菜单「学习报告」靠它认出点菜单的是哪个账号。
 * app.js 登录状态下每天最多调一次；失败静默（只影响服务号认人，下次再登记）。
 * 家长打开「学习报告」页时课程服务也会顺带登记。
 */
async function registerServiceAccountLink() {
  // 直接用本机存的凭证，不走 getRuntimeToken：启动时那条会在凭证失效时把人带去登录页；这里失效了课程服务回 401，静默作罢
  const token = getStoredToken()
  if (!token) throw new Error('NOT_LOGGED_IN')
  return requestAgentCourses('/api/learn/mp-link', token, { method: 'POST', data: {}, timeout: 15000, fallbackMessage: '' })
}

/**
 * 自己的代理身份（2026-11-10，课程服务 lib/agent-roles/self.ts）：爱心妈妈、导师妈妈、爱心妈妈团团长，管理端开通。
 * 回包 { roles: [{ key, label }], leader: { name, publicId } | null, team: { count, members } | null }；roles 为空就是不是代理。
 * 用本机凭证、不走 getRuntimeToken：「我的」对游客开放，凭证失效时这里只报错，不把人带去登录页。
 */
async function loadAgentIdentity() {
  const token = getStoredToken()
  if (!token) throw new Error('NOT_LOGGED_IN')
  const result = await requestAgentCourses('/api/learn/agent-identity', token, { timeout: 15000, fallbackMessage: '代理身份暂时无法读取，请稍后重试。' })
  const roles = (result && Array.isArray(result.roles) ? result.roles : [])
    .filter((item) => item && item.key && item.label)
    .map((item) => ({ key: String(item.key), label: String(item.label) }))
  const person = (item) => item && item.publicId ? { name: String(item.name || '未命名'), publicId: String(item.publicId) } : null
  const team = result && result.team
    ? { count: Number(result.team.count) || 0, members: (Array.isArray(result.team.members) ? result.team.members : []).map(person).filter(Boolean) }
    : null
  return { roles, leader: person(result && result.leader), team }
}

/**
 * 家长微信加好友二维码（2026-11-11 用户规则，课程服务 /api/learn/family-wechat-qr）：开会员付款前必须上传，
 * 客服和接单的导师妈妈用它加家长微信。一个账号一张，重新上传覆盖。
 */
// 个人收货地址（2026-11-12 用户要求）：「个人信息」里调 wx.chooseAddress 选微信收货地址，存课程服务（一人一条）。
async function loadShippingAddress() {
  const token = await getRuntimeToken()
  const result = await requestAgentCourses('/api/learn/shipping-address', token, { fallbackMessage: '收货地址暂时读不到，请稍后重试。' })
  return result && result.address || null
}

async function saveShippingAddress(address) {
  const token = await getRuntimeToken()
  const result = await requestAgentCourses('/api/learn/shipping-address', token, {
    method: 'POST', data: { address }, fallbackMessage: '收货地址没有保存成功，请稍后重试。'
  })
  return result && result.address || null
}

async function loadFamilyWechatQr() {
  const token = await getRuntimeToken()
  const result = await requestAgentCourses('/api/learn/family-wechat-qr', token, { fallbackMessage: '微信二维码状态暂时读不到，请稍后重试。' })
  return { uploaded: result && result.uploaded === true, uploadedAt: result && result.uploadedAt || '' }
}

// 本人上传过的二维码存成本地文件给 <image> 预览（课程服务只回 JPEG 字节）
async function downloadFamilyWechatQr() {
  const token = await getRuntimeToken()
  const filePath = `${wx.env.USER_DATA_PATH}/family-wechat-qr.jpg`
  const bytes = await new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/family-wechat-qr?image=1`, method: 'GET', timeout: 20000,
    header: { authorization: `Bearer ${token}` }, responseType: 'arraybuffer',
    success(response) {
      if (response.statusCode === 200 && response.data && response.data.byteLength) return resolve(response.data)
      reject(new Error('二维码暂时读不到，请稍后重试。'))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
  wx.getFileSystemManager().writeFileSync(filePath, bytes)
  return filePath
}

async function uploadFamilyWechatQr(filePath) {
  const file = await readLocalFile(filePath).catch(() => null)
  const bytes = file && file.data
  if (!bytes || !bytes.byteLength) throw new Error('图片读取失败，请重新选择。')
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('图片太大了，请换一张截图。')
  const extension = String(filePath).split('.').pop().toLowerCase()
  const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
  const response = await requestCourseUpload('/api/learn/family-wechat-qr', { bytes, fileName: `wechat-qr.${extension === 'png' || extension === 'webp' ? extension : 'jpg'}`, contentType })
  if (response.statusCode !== 201 || !response.data || response.data.uploaded !== true) {
    const code = response.data && response.data.code
    throw new Error(code === 'IMAGE_INVALID' ? '这张图片打不开，请换一张截图。' : code === 'FILE_TOO_LARGE' ? '图片太大了，请换一张截图。' : code === 'LOGIN_REQUIRED' ? '请重新登录后再上传。' : '上传没有成功，请稍后重试。')
  }
  return { uploaded: true, uploadedAt: response.data.uploadedAt || '' }
}

/**
 * 爱心妈妈 / 团长绑定家庭（2026-11-10，课程服务 /api/learn/agent-family）：输入家长用户 ID，先看是谁再确认；绑定后自己不能改。
 * 回包 { canBind, families: [{ publicId, name, boundAt, children: [{ name, grade }] }] }。
 */
async function loadAgentFamilies() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-family', token, { fallbackMessage: '绑定的家庭暂时无法读取，请稍后重试。' })
}

async function lookupAgentFamily(publicId) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-family', token, {
    method: 'POST', data: { operation: 'lookup', publicId: String(publicId || '').trim() }, fallbackMessage: '暂时查不到这个用户，请稍后重试。'
  })
}

async function bindAgentFamily(publicId) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-family', token, {
    method: 'POST', data: { operation: 'bind', publicId: String(publicId || '').trim() }, fallbackMessage: '绑定没有成功，请稍后重试。'
  })
}

/**
 * 代理带来的新家庭的免费体验（2026-11-11，课程服务 /api/learn/agent-trial）：一个家庭一次免费基础测评、
 * 测完的 PDF 报告和话术、免费诊断会议申请、免费 3 节课用量。只有绑定这个家庭的爱心妈妈 / 团长能用。
 */
async function loadAgentTrial(guardianPublicId) {
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/learn/agent-trial?guardianPublicId=${encodeURIComponent(String(guardianPublicId || ''))}`, token, {
    fallbackMessage: '免费体验暂时无法读取，请稍后重试。'
  })
}

async function openAgentTrialTest(guardianPublicId, studentProfileId) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-trial', token, {
    method: 'POST', data: { operation: 'open_test', guardianPublicId: String(guardianPublicId || ''), studentProfileId }, fallbackMessage: '没有开通成功，请稍后重试。'
  })
}

async function requestAgentTrialMeeting(guardianPublicId, note) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-trial', token, {
    method: 'POST', data: { operation: 'request_meeting', guardianPublicId: String(guardianPublicId || ''), note: String(note || '').trim() }, fallbackMessage: '申请没有提交成功，请稍后重试。'
  })
}

async function loadAgentTrialScript(guardianPublicId, regenerate = false) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-trial', token, {
    method: 'POST', timeout: 60000, data: { operation: 'script', guardianPublicId: String(guardianPublicId || ''), regenerate: regenerate === true }, fallbackMessage: '话术没有写好，请再点一次。'
  })
}

/** 下载免费测评的 PDF 报告到本地临时文件，返回路径（用 wx.openDocument 打开、可转发）。 */
// course.zideer.cn 只在 request 合法域名里、不在 downloadFile 里（wx.downloadFile 直接失败）：
// 同老师端家长报告，用 request 取二进制再写进本地文件。
async function downloadAgentTrialReport(guardianPublicId) {
  const token = await getRuntimeToken()
  const publicId = String(guardianPublicId || '').replace(/[^0-9A-Za-z]/g, '')
  const filePath = `${wx.env.USER_DATA_PATH}/agent-trial-report-${publicId || 'family'}.pdf`
  const data = await new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/agent-trial/report?guardianPublicId=${encodeURIComponent(String(guardianPublicId || ''))}`,
    method: 'GET',
    timeout: 120000,
    responseType: 'arraybuffer',
    header: { authorization: `Bearer ${token}` },
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('登录账号已变化，请重新打开页面。'))
      if (response.statusCode === 200 && response.data && response.data.byteLength > 64) return resolve(response.data)
      const messages = { 401: '请重新登录后再试。', 403: '你还没有绑定家庭的代理身份。', 404: '这个家庭不在你名下。', 409: '孩子测完以后才有报告。' }
      reject(new Error(messages[response.statusCode] || '报告暂时生成不了，请稍后重试。'))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
  await new Promise((resolve, reject) => wx.getFileSystemManager().writeFile({
    filePath,
    data,
    success: resolve,
    fail: () => reject(new Error('报告没有保存到手机，请检查存储空间后重试。'))
  }))
  return filePath
}

/**
 * 代理身份申请（2026-11-10，课程服务 /api/learn/agent-application）：本人勾选身份申请；团长替别人申请爱心妈妈。
 * 回包 { catalog, roles, verified, application, canPropose, proposals }。
 */
async function loadAgentApplication() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-application', token, { fallbackMessage: '代理申请暂时无法读取，请稍后重试。' })
}

async function submitAgentApplication({ roles, contactPhone, note } = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-application', token, {
    method: 'POST',
    data: { operation: 'submit', roles: roles || [], contactPhone: String(contactPhone || '').replace(/\s+/g, ''), note: String(note || '').trim() },
    fallbackMessage: '申请没有提交成功，请稍后重试。'
  })
}

async function proposeLoveMom({ publicId, contactPhone, note } = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/agent-application', token, {
    method: 'POST',
    data: { operation: 'propose', publicId: String(publicId || '').trim(), contactPhone: String(contactPhone || '').replace(/\s+/g, ''), note: String(note || '').trim() },
    fallbackMessage: '申请没有提交成功，请稍后重试。'
  })
}

/**
 * 学生的学习偏好（课程服务 lib/course/learning-preference.ts，2026-10-07）：「学习宇宙 › 学习偏好」读写自己的，
 * 回包带内置提示词目录。诊断会议开场时随学习基本盘一起交给 AI 老师（loadLearnerBaseline）。
 */
async function loadLearningPreference() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/learning-preference', token, { fallbackMessage: '学习偏好暂时无法读取，请稍后重试。' })
}

async function saveLearningPreference({ choices, note } = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/learning-preference', token, {
    method: 'POST',
    data: { choices: choices || {}, note: String(note || '') },
    fallbackMessage: '学习偏好没有保存成功，请稍后重试。'
  })
}

/**
 * 家长「我的孩子没有微信」（2026-10-09，课程服务 lib/portal/child-accounts.ts）：给孩子建网页端账号（登录名是孩子的 6 位编号，
 * 密码家长设），列出建过的孩子，改孩子的网页端密码。家长身份、实名与 22 周岁、最多 5 个孩子都由后端判断。
 * 服务商（2026-10-11）：list 多返回 provider = { limit, used }（used = 所有在用的绑定，含绑定码绑的），不查实名、不受 5 个限制。
 */
async function loadWebChildren() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/guardian-children', token, {
    method: 'POST', data: { operation: 'list' }, fallbackMessage: '孩子的网页端账号暂时读不到，请稍后重试。'
  })
}

async function createWebChild(input = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/guardian-children', token, {
    method: 'POST',
    timeout: 30000,
    data: {
      operation: 'create',
      requestKey: String(input.requestKey || ''),
      nickname: String(input.nickname || ''),
      grade: Number(input.grade),
      semester: String(input.semester || ''),
      textbookVersion: String(input.textbookVersion || ''),
      schoolName: String(input.schoolName || ''),
      regionDetail: String(input.regionDetail || ''),
      password: String(input.password || '')
    },
    fallbackMessage: '孩子的账号没有创建成功，请稍后重试。'
  })
}

async function setWebChildPassword(studentProfileId, password) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/guardian-children', token, {
    method: 'POST',
    data: { operation: 'set_password', studentProfileId: String(studentProfileId || ''), password: String(password || '') },
    fallbackMessage: '密码没有改成功，请稍后重试。'
  })
}

/** 学生自己定的学习目标（课程服务 lib/course/learning-goal.ts）：「学习宇宙 › 我的学习目标」读写。 */
async function loadLearningGoal() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/learning-goal', token, { fallbackMessage: '学习目标暂时无法读取，请稍后重试。' })
}

async function saveLearningGoal({ direction, goal, deadline } = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/learning-goal', token, {
    method: 'POST',
    data: { direction: String(direction || ''), goal: String(goal || ''), deadline: String(deadline || '') },
    fallbackMessage: '学习目标没有保存成功，请稍后重试。'
  })
}

/**
 * 按目标测评（课程服务 lib/goal-diagnosis，2026-10-10 用户规则）：围绕学习目标出题，错了就沿知识图谱往前置知识点挖。
 * loadGoalDiagnosis：目标 + 最近一次测评的导图；goalDiagnosis(operation, data)：start / read / answer / pause / resume。
 */
async function loadGoalDiagnosis() {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/goal-diagnosis', token, { fallbackMessage: '测评暂时无法打开，请稍后重试。' })
}

async function goalDiagnosis(operation, data = {}) {
  const token = await getRuntimeToken()
  return requestAgentCourses('/api/learn/goal-diagnosis', token, {
    method: 'POST',
    // start 时可能要先让模型认学科，留够时间
    timeout: operation === 'start' ? 40000 : 20000,
    data: { ...data, operation },
    fallbackMessage: operation === 'answer' ? '答案没有提交成功，请再点一次。' : '测评暂时无法打开，请稍后重试。'
  })
}

/**
 * 诊断会议「朗读」（2026-10-10）：老师说的一句话交给课程服务 /api/learn/speech，用后台的语音合成（优先豆包 / 火山引擎）
 * 读成 mp3，返回 ArrayBuffer。播放与本地缓存在 services/learn-speech.js。
 */
async function loadSpeechAudio(text) {
  const token = await getRuntimeToken()
  const messages = {
    SPEECH_UNAVAILABLE: '朗读暂时用不了，请稍后再试。',
    SPEECH_FAILED: '这句话没读出来，请再点一次。',
    SPEECH_DAILY_LIMIT: '今天朗读的次数用完了，明天再来。',
    SPEECH_TEXT_REQUIRED: '这句话没有可以朗读的文字。',
    LOGIN_REQUIRED: '请重新登录后再试。'
  }
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/speech`,
    method: 'POST',
    timeout: 30000,
    responseType: 'arraybuffer',
    header: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    data: { text: String(text || '') },
    success(response) {
      const type = String((response.header && (response.header['content-type'] || response.header['Content-Type'])) || '')
      if (response.statusCode === 200 && type.indexOf('audio/') === 0 && response.data && response.data.byteLength) return resolve(response.data)
      let code = ''
      try {
        code = JSON.parse(String.fromCharCode.apply(null, new Uint8Array(response.data || new ArrayBuffer(0)))).code || ''
      } catch (error) {
        code = ''
      }
      const error = new Error(messages[code] || '这句话暂时读不出来，请稍后再试。')
      error.code = code
      reject(error)
    },
    fail() {
      reject(new Error('网络不太稳定，朗读没有加载出来。'))
    }
  }))
}

/** 老师端学生详情：只读看学生最近一次按目标测评的导图。 */
async function loadTeacherGoalDiagnosis(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/goal-diagnosis?studentProfileId=${id}`, token, { fallbackMessage: '目标导图暂时无法读取，请稍后重试。' })
}

/** 老师端学生详情：只读看学生的学习目标与偏好（回包的 goal），没设置时引导学生去「学习宇宙」完善。 */
async function loadTeacherLearningPreference(studentProfileId) {
  const id = teacherStudentId(studentProfileId)
  const token = await getRuntimeToken()
  return requestAgentCourses(`/api/teacher/learning-preference?studentProfileId=${id}`, token, { fallbackMessage: '学习偏好暂时无法读取，请稍后重试。' })
}

/** 学生「学习 › 学习任务」：老师排好的今天起 7 天的任务，前几天没学完的带到今天。 */
async function loadStudyPlanDays() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/study-plan', token, { fallbackMessage: '学习任务暂时无法读取，请稍后重试。' })
  return {
    today: typeof data.today === 'string' ? data.today : '',
    dailyMinutes: Number(data.dailyMinutes) || 0,
    days: (Array.isArray(data.days) ? data.days : []).map((day) => ({
      day: String(day && day.day || ''),
      // 老师设的休息日（每周学习日以外、或单独标的）
      rest: Boolean(day && day.rest === true),
      minutes: Number(day && day.minutes) || 0,
      tasks: (Array.isArray(day && day.tasks) ? day.tasks : [])
        .filter((task) => task && isAgentCourseId(task.stageId))
        .map((task) => ({
          id: String(task.id || ''),
          // learn 学新课；review 间隔复习小测（2026-10-08，课程服务按复习卡现算）
          kind: task.kind === 'review' ? 'review' : 'learn',
          stageId: task.stageId,
          title: String(task.title || '定制课程'),
          pageLabel: String(task.pageLabel || ''),
          minutes: Number(task.minutes) || 0,
          progress: Math.max(0, Math.min(100, Number(task.progress) || 0)),
          done: task.done === true,
          started: task.started === true,
          nextSceneId: /^[A-Za-z0-9_-]{1,80}$/.test(String(task.nextSceneId || '')) ? task.nextSceneId : '',
          overdue: task.overdue === true,
          subject: String(task.subject || '')
        }))
    }))
  }
}

/** 「我的课程」里的智能体课程（含生成中的课程及进度），最新的在前。 */
async function loadAgentCourses() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/agent-courses', token)
  return (Array.isArray(data.courses) ? data.courses : [])
    .map((raw) => { const course = normalizeAgentCourse(raw); return course && { ...course, coverUrl: courseCoverUrl(raw.coverUrl) } })
    .filter(Boolean)
}

/** 课程链接进入后的实时生成进度。 */
async function loadAgentCourse(stageId) {
  if (!isAgentCourseId(stageId)) throw new Error('课程链接无效，请回到对话重新打开。')
  const token = await getRuntimeToken()
  const data = await requestAgentCourses(`/api/learn/agent-courses/${encodeURIComponent(stageId)}`, token)
  const course = normalizeAgentCourse(data.course)
  if (!course) throw new Error('课程进度数据暂不可用，请稍后重试。')
  return course
}

async function createLibraryCourseLaunchUrl(libraryCourseId) {
  if (typeof libraryCourseId !== 'string' || !/^[a-f0-9]{32}$/.test(libraryCourseId)) {
    throw new Error('课程信息不完整，请刷新后重试。')
  }
  return createLearnerEntryUrl({ libraryCourseId }, `library=${libraryCourseId}`)
}

function courseConnectionError(error) {
  const message = String(error && error.errMsg || '')
  const kind = /domain.*(list|allow)|合法域名|域名.*(配置|不|限制)/i.test(message) ? 'domain'
    : /ssl|certificate|cert_|证书/i.test(message) ? 'certificate'
      : /timeout|超时/i.test(message) ? 'timeout' : 'network'
  if (wx.setStorageSync) wx.setStorageSync('last_course_request_error', { kind, at: new Date().toISOString() })
  const messages = {
    domain: `微信阻止了课程接口请求，请在小程序后台将 ${coursePortalOrigin()} 添加到 request 合法域名。`,
    certificate: '课程服务的安全连接验证失败，请联系管理员检查域名证书。',
    timeout: '课程服务响应超时，请稍后重试。',
    network: '无法连接课程服务，请切换网络后重试。'
  }
  return new Error(messages[kind])
}

// 课程封面由课程服务按课程主题自动生成（见 OpenMAIC-sync lib/course/course-cover.ts），
// 接口返回 /api/course-covers/<哈希>.jpg 相对路径；还没生成好时为空，前端显示占位底色。
function courseCoverUrl(value) {
  const text = typeof value === 'string' ? value : ''
  return /^\/api\/course-covers\/[a-f0-9]{64}\.jpg$/.test(text) ? `${coursePortalOrigin()}${text}` : ''
}

/** 学习计划课程的封面：按课程内容标识批量读取；没有封面的由课程服务排队生成。 */
async function loadCourseCovers(refs) {
  const unique = Array.from(new Set((refs || []).filter((ref) => typeof ref === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(ref)))).slice(0, 50)
  if (!unique.length) return {}
  const token = await getRuntimeToken()
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/course-covers`, method: 'POST', timeout: 15000,
    header: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    data: { refs: unique },
    success(response) {
      const covers = response.statusCode === 200 && response.data && response.data.covers
      if (!covers || typeof covers !== 'object') return reject(new Error('课程封面暂时无法读取。'))
      const result = {}
      unique.forEach((ref) => { const url = courseCoverUrl(covers[ref]); if (url) result[ref] = url })
      resolve(result)
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

// 未登录也能看会员课程列表（2026-09-27 用户规则）：没有凭证（或凭证刚失效被作废）就不带凭证请求，
// 课程服务按非会员返回；还没建学习档案的账号课程服务同样按非会员返回。
async function loadMemberCourseLibrary() {
  let token = ''
  if (getStoredToken()) {
    try { token = await getRuntimeToken() } catch (error) { if (!isAuthenticationRequired(error)) throw error }
  }
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/library`, method: 'GET', timeout: 20000,
    header: token ? { authorization: `Bearer ${token}` } : {},
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请重新打开课程库。'))
      if (response.statusCode !== 200) {
        const messages = { LOGIN_REQUIRED: '请重新登录后查看课程库。', MEMBERSHIP_REQUIRED: '当前账号暂无课程库访问权限。', COURSE_ACCESS_DENIED: '当前学习账号暂不可访问课程库。' }
        const error = new Error(messages[response.data && response.data.code] || '课程库暂时无法读取，请稍后重试。')
        error.code = response.data && response.data.code
        return reject(error)
      }
      const courses = response.data && response.data.courses
      if (!Array.isArray(courses) || courses.some((course) => !course || !/^[a-f0-9]{32}$/.test(course.id) || typeof course.title !== 'string')) {
        return reject(new Error('课程库数据暂不可用，请稍后重试。'))
      }
      // isMember 由课程服务按当前账号给出，页面据此在点击时提前拦截非会员。
      resolve(courses.map((course) => ({ id: course.id, title: course.title, subject: String(course.subject || ''), grade: String(course.grade || ''), isMember: course.isMember !== false, coverUrl: courseCoverUrl(course.coverUrl) })))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

// 带当前登录凭证请求课程服务的学习端接口（/api/learn/**）。回 { statusCode, data }，由调用方按状态码解读；
// 网络、域名、证书问题转成中文提示；请求期间切换了账号则放弃结果。
async function requestCourseApi(path, { method = 'GET', data, timeout = 20000 } = {}) {
  const token = await getRuntimeToken()
  const url = `${coursePortalOrigin()}${path}`
  return new Promise((resolve, reject) => wx.request({
    url, method, timeout, data,
    header: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请刷新后重试。'))
      resolve({ statusCode: response.statusCode, data: response.data || {} })
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

function multipartAscii(text) {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff
  return bytes
}

// 带当前登录凭证向课程服务上传一个文件（手拼 multipart/form-data，走 wx.request）：与诊断室传录音同一做法，
// 不需要另配 uploadFile 合法域名。bytes 是 ArrayBuffer；文件名、类型只能是 ASCII。回 { statusCode, data }。
async function requestCourseUpload(path, { bytes, fieldName = 'file', fileName = 'file.bin', contentType = 'application/octet-stream', timeout = 60000 } = {}) {
  const token = await getRuntimeToken()
  const boundary = `----zhiluUpload${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`
  const head = multipartAscii(`--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`)
  const tail = multipartAscii(`\r\n--${boundary}--\r\n`)
  const file = new Uint8Array(bytes)
  const body = new Uint8Array(head.length + file.length + tail.length)
  body.set(head, 0)
  body.set(file, head.length)
  body.set(tail, head.length + file.length)
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}${path}`, method: 'POST', timeout,
    header: { 'content-type': `multipart/form-data; boundary=${boundary}`, authorization: `Bearer ${token}` },
    data: body.buffer, dataType: 'text', responseType: 'text',
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请刷新后重试。'))
      let data = response.data
      try { data = typeof data === 'string' ? JSON.parse(data) : data } catch (error) { data = {} }
      resolve({ statusCode: response.statusCode, data: data || {} })
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

async function createAcceptanceLaunchUrl(courseInstanceId, acceptanceId) {
  const normalizedCourseInstanceId = Number(courseInstanceId)
  const normalizedAcceptanceId = Number(acceptanceId)
  if (!Number.isSafeInteger(normalizedCourseInstanceId) || normalizedCourseInstanceId <= 0 || !Number.isSafeInteger(normalizedAcceptanceId) || normalizedAcceptanceId <= 0) {
    throw new Error('验收信息不完整，请返回后重试。')
  }

  return issueLearningEntry(normalizedCourseInstanceId, 'acceptance', normalizedAcceptanceId)
}

async function createCurrentFeynmanAcceptance(courseInstanceId) {
  const normalizedCourseInstanceId = Number(courseInstanceId)
  if (!Number.isSafeInteger(normalizedCourseInstanceId) || normalizedCourseInstanceId <= 0) {
    throw new Error('课程信息不完整，请刷新后重试。')
  }

  const data = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CREATE_CURRENT_FEYNMAN_ACCEPTANCE,
    { course_instance_id: normalizedCourseInstanceId }
  ))
  const messages = {
    unauthenticated: '请先登录后开始验收。',
    invalid_request: '验收参数不完整。',
    profile_incomplete: '请先完善学习档案。',
    not_authorized: '当前账号无权开始这节课程的验收。',
    course_not_ready: '请完成课程学习后再开始验收。'
  }
  if (!data || data.status !== 'ready' || !Number.isSafeInteger(Number(data.acceptanceId))) {
    throw new Error(messages[data && data.status] || '暂时无法创建验收，请稍后重试。')
  }
  return {
    acceptanceId: String(data.acceptanceId),
    courseInstanceId: String(data.courseInstanceId),
    topicId: data.topicId === null || data.topicId === undefined ? '' : String(data.topicId)
  }
}

function getAudioFormat(filePath) {
  const extension = String(filePath || '').split('.').pop().toLowerCase()
  if (extension === 'mp3') return { format: 'MP3', suffix: 'MP3', fileFormat: 'mp3' }
  if (extension === 'wav') return { format: 'WAV', suffix: 'WAV', fileFormat: 'wav' }
  if (extension === 'm4a') return { format: 'OTHER', suffix: 'OTHER', fileFormat: 'm4a' }
  if (extension === 'aac') return { format: 'OTHER', suffix: 'OTHER', fileFormat: 'aac' }
  throw new Error('录音格式不受支持，请重新录制。')
}

async function uploadCurrentAcceptanceAudio(acceptanceId, filePath, durationMs) {
  const normalizedAcceptanceId = Number(acceptanceId)
  const normalizedDuration = Number(durationMs)
  if (!Number.isSafeInteger(normalizedAcceptanceId) || normalizedAcceptanceId <= 0) {
    throw new Error('验收信息不完整，请重新开始。')
  }
  if (!filePath || !Number.isFinite(normalizedDuration) || normalizedDuration < 1000) {
    throw new Error('录音时间过短，请至少讲解 1 秒。')
  }

  const info = await getLocalFileInfo(filePath)
  const sizeBytes = Number(info.size || 0)
  if (!sizeBytes || sizeBytes > 25 * 1024 * 1024) {
    throw new Error('录音文件必须在 25MB 以内，请重新录制。')
  }

  const audio = getAudioFormat(filePath)
  const md5Base64 = md5HexToBase64(info.digest)
  const uploadData = await graphql(
    `mutation GetAcceptanceAudioUploadUrl(
      $md5: String!,
      $format: MediaFormat!,
      $name: String!,
      $suffix: String!,
      $sizeBytes: Int!,
      $acl: CannedAccessControlList!
    ) {
      filePresignedUrl(
        md5Base64: $md5,
        format: $format,
        name: $name,
        suffix: $suffix,
        sizeBytes: $sizeBytes,
        acl: $acl
      ) {
        fileId uploadUrl uploadHeaders
      }
    }`,
    {
      md5: md5Base64,
      format: audio.format,
      name: `feynman-acceptance-${normalizedAcceptanceId}.${audio.fileFormat}`,
      suffix: audio.suffix,
      sizeBytes,
      acl: 'PRIVATE'
    }
  )
  const presigned = uploadData && uploadData.filePresignedUrl
  if (!presigned || !presigned.fileId || !presigned.uploadUrl) {
    throw new Error('未获取到私有录音上传凭证，请稍后重试。')
  }

  const content = await readLocalFile(filePath)
  await putBinary(presigned.uploadUrl, presigned.uploadHeaders, content.data)

  const data = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.REGISTER_CURRENT_ACCEPTANCE_AUDIO,
    {
      acceptance_id: normalizedAcceptanceId,
      segment_no: 1,
      audio_file_id: Number(presigned.fileId),
      file_format: audio.fileFormat,
      duration_ms: Math.round(normalizedDuration),
      size_bytes: sizeBytes,
      md5_base64: md5Base64
    }
  ))
  const messages = {
    unauthenticated: '请先登录后上传录音。',
    invalid_request: '录音信息不完整，请重新录制。',
    not_authorized: '当前账号无权提交这次验收。',
    acceptance_not_recording: '本次验收已结束，请重新开始。',
    segment_conflict: '该验收已提交过不同录音，请重新开始新的验收。'
  }
  if (!data || !['registered', 'already_registered'].includes(data.status)) {
    throw new Error(messages[data && data.status] || '录音登记失败，请稍后重试。')
  }
  return {
    status: data.status,
    audioAssetId: String(data.audio_asset_id || ''),
    fileId: String(presigned.fileId)
  }
}

function parseActionFlowResult(result) {
  if (typeof result !== 'string') return result

  try {
    return JSON.parse(result)
  } catch (error) {
    throw new Error('服务返回的数据格式不正确。')
  }
}

function normalizeProfile(profile) {
  if (Array.isArray(profile)) profile = profile[0] || null
  if (!profile || typeof profile !== 'object') return null

  return {
    id: profile.id,
    public_id: /^[1-9][0-9]{5}$/.test(String(profile.public_id || '')) ? String(profile.public_id) : '',
    nickname: profile.nickname || '',
    account_type: ['student', 'guardian'].includes(profile.account_type) ? profile.account_type : '',
    gender: ['male', 'female'].includes(profile.gender) ? profile.gender : '',
    birthday_change_used: profile.birthday_change_used === true,
    real_name: profile.real_name || '',
    avatar_id: profile.avatar_id || profile.avatar && profile.avatar.id || null,
    avatar_url: profile.avatar && profile.avatar.url || profile.avatar_url || '',
    birthday: profile.birthday || '',
    status: profile.status || 'active',
    // 0 是「都不是」，不能被当成未填写
    current_grade: profile.current_grade === 0 || profile.current_grade === '0' ? 0 : profile.current_grade || null,
    school_stage: profile.school_stage || '',
    semester: profile.semester || '',
    school_name: profile.school_name || '',
    textbook_version: profile.textbook_version || '',
    region_detail: profile.region_detail || '',
    household_region: profile.household_region || '',
    // 实名认证后按身份证锁定（2026-09-26 用户规则）：后端直接给身份证上的值，页面不让改
    birthday_locked: profile.birthday_locked === true,
    gender_locked: profile.gender_locked === true,
    household_region_locked: profile.household_region_locked === true,
    profile_completed_at: profile.profile_completed_at || null
  }
}

function buildCurrentUser(userPrincipalId, profile) {
  const normalizedProfile = normalizeProfile(profile)
  // 底栏按身份画四项或五项（家长没有「图谱」），每次读到档案都记下身份
  if (normalizedProfile && normalizedProfile.profile_completed_at) rememberAccountType(normalizedProfile)
  return {
    userPrincipalId: userPrincipalId || null,
    phoneVerified: Boolean(verifiedPhoneToken && verifiedPhoneToken === getStoredToken()),
    userProfileId: normalizedProfile ? normalizedProfile.id : null,
    profile: normalizedProfile,
    profileCompleted: Boolean(normalizedProfile && normalizedProfile.profile_completed_at)
  }
}

function parseWechatPaymentParams(signResult) {
  if (!signResult || signResult.status !== 'SUCCESS') {
    throw new Error((signResult && signResult.message) || '微信支付签名生成失败。')
  }

  let params = signResult.message
  if (typeof params === 'string') {
    try {
      params = JSON.parse(params)
    } catch (error) {
      throw new Error('微信支付签名格式不正确。')
    }
  }

  params = params && (params.payInfo || params.data || params)
  const requiredFields = ['timeStamp', 'nonceStr', 'package', 'signType', 'paySign']
  const missing = requiredFields.some((field) => !params || !params[field])
  if (missing) {
    throw new Error('微信支付签名不完整，请检查 Zion 微信支付配置。')
  }

  return {
    timeStamp: String(params.timeStamp),
    nonceStr: String(params.nonceStr),
    package: String(params.package),
    signType: String(params.signType),
    paySign: String(params.paySign),
  }
}

function requestWechatPayment(params) {
  return new Promise((resolve, reject) => {
    wx.requestPayment({
      ...params,
      success: resolve,
      fail: reject,
    })
  })
}

function normalizePaymentOrder(order) {
  const orderId = Number(order && order.orderId)
  const amount = Number(order && order.amount)
  const description = String(order && order.description || '').trim()

  if (!Number.isSafeInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || !description) {
    throw new Error('订单支付信息不完整，请刷新后重试。')
  }

  return { orderId, amount, description }
}

function isWechatPaymentCancelled(error) {
  return /cancel/i.test(String(error && (error.errMsg || error.message) || ''))
}

async function payWechatOrder(order) {
  const { orderId, amount, description } = normalizePaymentOrder(order)
  // 支付开关关着就不发起支付：待支付订单的「继续支付」不经过下单流程，只能在这里拦（services/payment-switch.js）
  await assertPaymentOpen()
  const token = await getRuntimeToken()
  let params
  try {
    const data = await graphql(
    `mutation CreateWechatPayment($orderId: Long!, $description: String!, $amount: BigDecimal!) {
      createWechatPayment(
        type: WECHATPAY_MINIPROGRAM
        orderId: $orderId
        description: $description
        amount: $amount
      ) {
        status
        message
      }
    }`,
    { orderId, description, amount },
    { expectedToken: token, timeout: 20000 }
  )
    params = parseWechatPaymentParams(data.createWechatPayment)
    if (getStoredToken() !== token) throw new Error('账号已变化，请重新打开支付页面。')
  } catch (error) {
    error.paymentNotStarted = true
    throw error
  }
  await requestWechatPayment(params)
  return { orderId }
}

async function startWechatPaymentTest() {
  const order = parseActionFlowResult(
    await invokeActionFlow(config.ACTION_FLOWS.CREATE_WECHAT_PAYMENT_TEST_ORDER)
  )
  return payWechatOrder(order)
}

async function loadCurrentUser() {
  let userPrincipalId
  for (let attempt = 0; attempt < 4; attempt++) {
    const token = getStoredToken()
    try {
      userPrincipalId = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.INITIALIZE_CURRENT_USER))
      break
    } catch (error) {
      if (!/PUBLIC_ID_RETRY|user_principal_public_id_unique/.test(String(error && error.message || ''))) throw error
      if (getStoredToken() !== token) throw new Error('登录账号已变化，请重新进入。')
      if (attempt === 3) throw new Error('用户编号暂时分配失败，请稍后重新进入。')
    }
  }
  const profile = parseActionFlowResult(
    await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE)
  )
  return buildCurrentUser(userPrincipalId, profile)
}

async function restoreAuthenticatedUser() {
  const token = getStoredToken()
  if (!token || token === 'mock-phone-authorized') {
    if (token) wx.removeStorageSync(TOKEN_KEY)
    return null
  }

  try {
    return await loadCurrentUser()
  } catch (error) {
    // A transient network or business-flow error must not turn a valid
    // session into a forced logout. The GraphQL wrapper marks actual token
    // rejections with AUTH_REQUIRED.
    if (isAuthenticationRequired(error) && getStoredToken() === token) wx.removeStorageSync(TOKEN_KEY)
    return null
  }
}

// 当前访问状态（2026-09-27 用户规则：未登录也能浏览）：guest 未登录；profile 已登录、学习档案未完善；ready 已建档。
// 读资料遇到网络等问题时按 ready 处理：交给各功能自己的读取给出错误，不把已登录的人当成游客。
async function loadViewerAccess() {
  if (!hasSession()) return 'guest'
  try {
    return (await loadCurrentUser()).profileCompleted ? 'ready' : 'profile'
  } catch (error) {
    return isAuthenticationRequired(error) ? 'guest' : 'ready'
  }
}

// 读取失败是因为没登录 / 没建档：换成访问状态交给页面显示提示；别的失败返回空，照常当读取失败。
function accessOfError(error) {
  if (isAuthenticationRequired(error)) return 'guest'
  if (isProfileRequired(error)) return 'profile'
  return ''
}

function signOut() {
  sessionGeneration += 1
  wx.removeStorageSync(TOKEN_KEY)
  clearAccountType()
  resetPhoneSessionVerification()
  authRedirectInProgress = false
}

// 学生切换为家长被后端拒绝（2026-09-25 用户规则）：报错以代码开头，换成页面能直接用的提示并带上 code
const GUARDIAN_SWITCH_ERRORS = {
  GUARDIAN_VERIFICATION_REQUIRED: '切换为家长需要先完成实名认证。',
  GUARDIAN_UNDERAGE: '实名认证显示未满 22 周岁，不能切换为家长。',
  GUARDIAN_AGE_UNKNOWN: '实名信息里没有出生日期，请重新提交一次实名认证。'
}

function guardianSwitchError(error) {
  const matched = /GUARDIAN_(VERIFICATION_REQUIRED|UNDERAGE|AGE_UNKNOWN)/.exec(String(error && error.message || ''))
  if (!matched) return null
  const code = `GUARDIAN_${matched[1]}`
  const wrapped = new Error(GUARDIAN_SWITCH_ERRORS[code])
  wrapped.code = code
  return wrapped
}

async function saveCurrentLearningProfile(form) {
  const sessionToken = getStoredToken()
  if (form.profileId) {
    const current = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {}, { expectedToken: sessionToken }))
    if (!current || String(current.id) !== String(form.profileId)) throw new Error('登录账号已变化，请重新进入个人资料后保存。')
  }
  const payload = {
    nickname: String(form.nickname || '').trim(),
    grade: Number(form.grade),
    school_stage: String(form.schoolStage || '').trim(),
    semester: String(form.semester || '').trim(),
    school_name: String(form.schoolName || '').trim(),
    textbook_version: String(form.textbookVersion || '').trim(),
    region_detail: String(form.regionDetail || '').trim()
  }

  const details = {}
  if (Object.prototype.hasOwnProperty.call(form, 'accountType')) {
    if (!['student', 'guardian'].includes(form.accountType)) throw new Error('请选择学生或家长身份。')
    details.account_type = form.accountType
  }
  if (Object.prototype.hasOwnProperty.call(form, 'birthday')) details.birthday = form.birthday || null
  // 性别、户籍地选填（2026-09-26 用户规则）：没选就不提交，不会清掉已存的
  if (Object.prototype.hasOwnProperty.call(form, 'gender') && form.gender) {
    if (!['male', 'female'].includes(form.gender)) throw new Error('请选择性别。')
    details.gender = form.gender
  }
  const householdRegion = String(form.householdRegion || '').trim()
  if (householdRegion) details.household_region = householdRegion
  if (form.avatarPath) details.avatar_id = await uploadProfileAvatar(form.avatarPath, sessionToken)
  if (Object.keys(details).length) payload.personal_details = details
  if (!sessionToken || getStoredToken() !== sessionToken) throw new Error('登录账号已变化，请重新进入个人资料后保存。')

  let userProfileId
  try {
    userProfileId = parseActionFlowResult(
      await invokeActionFlow(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE, payload, { expectedToken: sessionToken })
    )
  } catch (error) {
    throw guardianSwitchError(error) || error
  }
  const profile = await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {}, { expectedToken: sessionToken })
  if (getStoredToken() !== sessionToken) throw new Error('登录账号已变化，请重新读取个人资料。')
  const saved = normalizeProfile(parseActionFlowResult(profile))
  if (!saved || String(saved.id) !== String(userProfileId) || saved.nickname !== payload.nickname || Number(saved.current_grade) !== payload.grade || saved.semester !== payload.semester ||
      // 已实名的生日、性别、户籍地由后端按身份证写入，不跟提交值比
      (Object.prototype.hasOwnProperty.call(details, 'birthday') && !saved.birthday_locked && saved.birthday !== (details.birthday || '')) ||
      (Object.prototype.hasOwnProperty.call(details, 'gender') && !saved.gender_locked && saved.gender !== details.gender) ||
      (details.household_region && !saved.household_region_locked && saved.household_region !== details.household_region) ||
      (details.account_type && saved.account_type !== details.account_type) ||
      (details.avatar_id && String(saved.avatar_id) !== String(details.avatar_id))) {
    throw new Error('保存结果未确认，请重新进入个人资料查看后再试。')
  }
  return buildCurrentUser(null, saved)
}

async function uploadProfileAvatar(filePath, expectedToken) {
  const info = await getLocalFileInfo(filePath)
  if (!info.size || info.size > 5 * 1024 * 1024) throw new Error('头像图片不能超过 5MB。')
  const image = await getLocalImageInfo(filePath)
  if (!image.width || !image.height || !['png', 'jpg', 'jpeg', 'webp'].includes(String(image.type || '').toLowerCase())) {
    throw new Error('请选择 JPG、PNG 或 WebP 格式的头像。')
  }
  const data = await graphql(
    `mutation GetProfileAvatarUploadUrl($md5: String!, $suffix: MediaFormat!, $acl: CannedAccessControlList!) {
      imagePresignedUrl(imgMd5Base64: $md5, imageSuffix: $suffix, acl: $acl) { imageId uploadUrl uploadHeaders }
    }`,
    { md5: md5HexToBase64(info.digest), suffix: image.type.toUpperCase(), acl: 'PRIVATE' },
    { expectedToken }
  )
  const upload = data && data.imagePresignedUrl
  if (!upload || !upload.imageId || !upload.uploadUrl) throw new Error('头像上传凭证获取失败，请重试。')
  const content = await readLocalFile(filePath)
  await putBinary(upload.uploadUrl, upload.uploadHeaders, content.data)
  return String(upload.imageId)
}

function profileDisplayName(profile) {
  return profile.nickname || profile.real_name || '学习用户'
}

function profileInitial(profile) {
  return profileDisplayName(profile).slice(0, 1)
}

// 头像是后端下发的签名地址，约两天过期，只在本次加载里用，不要存起来。
function profileAvatarUrl(profile) {
  if (!profile) return ''
  return profile.avatar_url || profile.avatar && profile.avatar.url || ''
}

function profileGradeLabel(profile) {
  const grade = Number(profile.current_grade)
  if (grade >= 1 && grade <= 6) return `小学${grade}年级`
  if (grade >= 7 && grade <= 9) return `初${grade - 6}`
  if (grade >= 10 && grade <= 12) return `高${grade - 9}`
  return '未设置年级'
}

async function loadCurrentStudentDashboardBase() {
  const currentUser = await loadCurrentUser()
  if (!currentUser.profileCompleted || !currentUser.profile) {
    throw createProfileRequiredError()
  }

  const profile = currentUser.profile
  const student = {
    id: profile.id,
    name: profileDisplayName(profile),
    relation: '本人',
    initial: profileInitial(profile),
    gradeLabel: profileGradeLabel(profile)
  }
  return { profile, student }
}

async function loadHomeDashboard() {
  const { student } = await loadCurrentStudentDashboardBase()
  const [plansResult, assessmentResult, reportsResult, creditResult, growthResult, notificationsResult] = await Promise.allSettled([
    loadCurrentLearningPlans(),
    loadAssessmentCenter(),
    loadCurrentDiagnosticReports(),
    loadCurrentCreditAccount(),
    loadCurrentGrowthCenter(),
    loadCurrentNotifications()
  ])
  const plans = plansResult.status === 'fulfilled' ? plansResult.value.plans || [] : []
  const activePlan = plans.find((item) => ['active', 'generating', 'draft', 'paused'].includes(String(item.status || '').toLowerCase())) || plans[0] || null
  const planItems = activePlan && activePlan.items || []
  const completedCount = planItems.filter((item) => ['completed', 'done', 'passed'].includes(String(item.status || '').toLowerCase())).length
  const currentItem = planItems.find((item) => !['completed', 'done', 'passed'].includes(String(item.status || '').toLowerCase())) || null
  const assessmentData = assessmentResult.status === 'fulfilled' ? assessmentResult.value : null
  const latestAttempt = assessmentData && assessmentData.attempts && assessmentData.attempts[0] || null
  const reportData = reportsResult.status === 'fulfilled' ? reportsResult.value : null
  const latestReport = reportData && (reportData.reports || []).find((item) => ['completed', 'ready'].includes(String(item.status || '').toLowerCase())) || reportData && reportData.reports && reportData.reports[0] || null
  const latestPrediction = reportData && reportData.predictions && reportData.predictions[0] || null
  const creditData = creditResult.status === 'fulfilled' ? creditResult.value : null
  const growthData = growthResult.status === 'fulfilled' ? growthResult.value : null
  const notifications = notificationsResult.status === 'fulfilled' ? notificationsResult.value : []
  return {
    currentStudentId: student.id,
    students: [student],
    today: activePlan ? {
      completed: completedCount,
      total: planItems.length,
      currentTask: currentItem && currentItem.topicName || activePlan.name || '学习计划',
      currentTaskMeta: currentItem && currentItem.estimatedMinutes ? `约 ${currentItem.estimatedMinutes} 分钟` : '等待学习任务生成',
      progress: planItems.length ? Math.round(completedCount / planItems.length * 100) : 0
    } : null,
    assessment: latestAttempt ? {
      id: latestAttempt.id,
      status: latestAttempt.status,
      statusLabel: latestAttempt.statusLabel,
      subjectKey: latestAttempt.subjectKey,
      subject: latestAttempt.subjectName,
      // Score predictions are not knowledge-mastery measurements. Keep the
      // dashboard honest until the mastery endpoint provides a percentage.
      masteryLabel: latestReport ? '诊断已完成' : '暂无有效诊断',
      weakCount: latestReport && latestReport.weakTopics && latestReport.weakTopics.length || latestPrediction && latestPrediction.weakTopics && latestPrediction.weakTopics.length || 0,
      forecast: latestPrediction && latestPrediction.scoreRange || '数据不足',
      confidence: latestPrediction && latestPrediction.confidencePercent !== null ? `${latestPrediction.confidencePercent}% 置信度` : '数据不足',
      measuredAt: latestAttempt.updated_at || latestAttempt.created_at || ''
    } : null,
    plan: activePlan ? {
      id: activePlan.id,
      name: activePlan.name || '学习计划',
      phase: activePlan.status || '执行中',
      progress: planItems.length ? Math.round(completedCount / planItems.length * 100) : 0,
      nextMilestone: currentItem && currentItem.topicName || '等待下一项任务'
    } : null,
    balances: {
      coursePoints: creditData ? creditData.account.available : null,
      frozenPoints: creditData ? creditData.account.frozen : null,
      coins: growthData ? growthData.coinAccount.available : null,
      coinHint: growthData ? `冻结 ${growthData.coinAccount.frozen} 金币` : '金币账户暂不可读取'
    },
    message: notifications[0] || null
  }
}

async function loadLearningDashboard() {
  const { student } = await loadCurrentStudentDashboardBase()
  const data = await loadCurrentLearningPlans()
  const plans = Array.isArray(data.plans) ? data.plans : []
  const activePlan = plans.find((plan) => ['active', 'generating', 'draft', 'paused'].includes(String(plan.status || '').toLowerCase())) || plans[0] || null
  const items = activePlan && activePlan.items || []
  const allItems = plans.flatMap((plan) => (plan.items || []).map((item) => ({ item, planId: plan.id })))
  const completeStatuses = ['completed', 'done', 'passed']
  const completed = items.filter((item) => completeStatuses.includes(String(item.status || '').toLowerCase())).length
  const currentItem = items.find((item) => !completeStatuses.includes(String(item.status || '').toLowerCase())) || null
  const currentCourse = currentItem && (currentItem.courseInstances || [])[0] || null
  const generation = courseGenerationState(currentCourse, currentItem && currentItem.generationJob, currentItem && currentItem.status || 'planned')
  const settlement = currentCourse && currentCourse.creditSettlement || null

  const myCourses = []
  const seenCourseIds = new Set()
  allItems.forEach(({ item, planId }) => {
    const course = (item.courseInstances || [])[0] || null
    if (!course) return
    const courseId = String(course.id || '')
    if (!courseId || seenCourseIds.has(courseId)) return
    const generationState = courseGenerationState(course, item.generationJob, item.status)
    if (!generationState.canLaunch) return
    seenCourseIds.add(courseId)
    const done = completeStatuses.includes(String(item.status || '').toLowerCase())
    const progress = courseTaskProgress(course, item.generationJob, item.status)
    myCourses.push({
      id: courseId,
      planId: String(planId),
      courseInstanceId: courseId,
      ...progress,
      canLaunch: true,
      canStartAcceptance: generationState.canStartAcceptance,
      courseStatus: generationState.courseStatus,
      stateLabel: done ? '已完成' : generationState.label,
      contentVersionRef: String(course.contentVersionRef || ''),
      title: item.topicName || '学习任务',
      subject: item.subjectName || '学习计划',
      meta: item.subjectName || item.domainName || '课程学习',
      time: Number(item.sequenceNo) ? `第 ${item.sequenceNo} 项` : '学习课程'
    })
  })

  return {
    currentStudentId: student.id,
    students: [student],
    summary: activePlan ? {
      completed,
      total: items.length,
      focusMinutes: 0,
      streak: 0,
      planName: activePlan.name || '学习计划',
      planId: activePlan.id
    } : null,
    currentTask: currentItem ? {
      id: currentItem.id,
      planId: activePlan.id,
      courseInstanceId: generation.canLaunch && currentCourse ? String(currentCourse.id) : null,
      acceptanceCourseInstanceId: generation.canStartAcceptance && currentCourse ? String(currentCourse.id) : null,
      generationCourseInstanceId: currentCourse ? String(currentCourse.id) : null,
      title: currentItem.topicName || '学习任务',
      subject: currentItem.subjectName || '学习计划',
      topic: currentItem.domainName || '知识点学习',
      duration: currentItem.estimatedMinutes || 0,
      ...courseTaskProgress(currentCourse, currentItem.generationJob, currentItem.status),
      status: generation.label
    } : null,
    tasks: items.map((item) => {
      const course = (item.courseInstances || [])[0] || null
      const settlement = course && course.creditSettlement
      const done = completeStatuses.includes(String(item.status || '').toLowerCase())
      const generationState = courseGenerationState(course, item.generationJob, item.status)
      const label = !done && (course || item.generationJob)
        ? generationState.label
        : learningPlanItemStatusLabel(item.status)
      const creditState = courseCreditState(settlement)
      const credits = creditState ? creditState.summary
        : item.estimatedCredits === null || item.estimatedCredits === undefined
          ? '' : `预计 ${roundedCredits(item.estimatedCredits)} 积分`
      return {
        id: item.id,
        planId: activePlan.id,
        ...courseTaskProgress(course, item.generationJob, item.status),
        canPoll: generationState.canPoll,
        canLaunch: generationState.canLaunch,
        canStartAcceptance: generationState.canStartAcceptance,
        courseStatus: generationState.courseStatus,
        stateLabel: generationState.label,
        courseInstanceId: course ? String(course.id) : '',
        contentVersionRef: String(course && course.contentVersionRef || ''),
        title: item.topicName || '学习任务',
        meta: credits ? `${label} · ${credits}` : label,
        time: Number(item.sequenceNo) ? `第 ${item.sequenceNo} 项` : '学习任务',
        status: done ? 'done' : String(item.id) === String(currentItem && currentItem.id) ? 'active' : 'waiting'
      }
    }),
    myCourses,
    generation: currentItem ? {
      ...generation,
      planItemId: String(currentItem.id),
      courseInstanceId: currentCourse ? String(currentCourse.id) : null,
      settlement,
      pointsRange: settlement && settlement.estimatedLowerCredits !== null && settlement.estimatedLowerCredits !== undefined
        ? `预计 ${roundedCredits(settlement.estimatedLowerCredits)}-${roundedCredits(settlement.estimatedUpperCredits)} 积分`
        : currentItem.estimatedCredits === null || currentItem.estimatedCredits === undefined
          ? '积分结算信息将在报价后显示'
          : `预计 ${roundedCredits(currentItem.estimatedCredits)} 积分`
    } : null,
    acceptance: null
  }
}

function graphStatus(mastery) {
  const status = String(mastery && mastery.status || '').toLowerCase()
  if (status==='unknown' && mastery && mastery.lastAssessmentScore !== null && mastery.lastAssessmentScore !== undefined) return {key:'provisional',label:mastery.lastAssessmentScore===1?'初测答对，待复测':'初测答错，待复测'}
  if (status === 'assessed_stable') return { key: 'assessed_stable', label: '测评较稳' }
  // AI 验收通过、等老师最终核验；老师核验通过后才是 mastered。
  if (status === 'pending_teacher') return { key: 'pending_teacher', label: '待老师核验' }
  if (status === 'reinforce') return { key: 'weak', label: '待巩固' }
  if (['mastered', 'completed', 'passed'].includes(status)) return { key: 'mastered', label: '已掌握' }
  if (['learning', 'in_progress', 'planned'].includes(status)) return { key: 'learning', label: '计划中' }
  if (['weak', 'needs_review', 'remedial'].includes(status)) return { key: 'weak', label: '需加强' }
  return { key: 'unknown', label: '待测' }
}

function gradeLabel(grade) {
  const gradeNumber = Number(grade)
  if (gradeNumber >= 1 && gradeNumber <= 6) return `小学${gradeNumber}年级`
  if (gradeNumber >= 7 && gradeNumber <= 9) return `初${gradeNumber - 6}`
  if (gradeNumber >= 10 && gradeNumber <= 12) return `高${gradeNumber - 9}`
  return ''
}

const subjectNames = {
  Chinese: '语文',
  Mathematics: '数学',
  English: '英语',
  Physics: '物理',
  Chemistry: '化学',
  Biology: '生物',
  History: '历史',
  Geography: '地理',
  Politics: '道德与法治',
  'Information Technology': '信息科技'
}

function assessmentStatusLabel(status) {
  const labels = {
    draft: '进行中',
    submitted: '已完成',
    partial: '部分完成',
    analyzing: '分析中',
    analysis_failed: '分析失败',
    completed: '已完成'
  }
  return labels[status] || '处理中'
}

function timestampForLatestItem(item = {}) {
  const value = item.updated_at || item.updatedAt || item.completed_at || item.completedAt || item.generated_at || item.generatedAt || item.submitted_at || item.submittedAt || item.created_at || item.createdAt || ''
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function sortLatestFirst(items = []) {
  return items.slice().sort((left, right) => {
    const timestampDelta = timestampForLatestItem(right) - timestampForLatestItem(left)
    if (timestampDelta) return timestampDelta
    return Number(right.id || 0) - Number(left.id || 0)
  })
}

function learningPlanItemStatusLabel(status) {
  const labels = {
    available: '可开始', planned: '等待生成', queued: '等待生成', generating: '课程生成中',
    validating: '内容校验中', ready: '课程已就绪', learning: '学习中',
    lesson_completed: '等待验收', awaiting_acceptance: '等待验收', completed: '已完成',
    done: '已完成', passed: '已完成', locked: '等待前置任务',
    blocked_insufficient_credit: '积分不足', failed: '生成失败', cancelled: '已取消'
  }
  return labels[String(status || '').toLowerCase()] || '待安排'
}

function parseAssessmentResult(result) {
  const data = parseActionFlowResult(result)
  if (!data || typeof data !== 'object') throw new Error('测评服务返回的数据格式不正确。')
  return data
}

async function loadAssessmentCenter() {
  const data = parseAssessmentResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_CENTER))
  if (data.status === 'unauthenticated') throw new Error('请先登录后查看测评。')
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('测评中心暂时不可用。')

  return {
    profile: data.profile,
    subjects: (data.subjects || []).map((subject) => ({
      key: subject.key,
      name: subject.name || subjectNames[subject.key] || subject.key,
      readyCount: Number(subject.readyCount || 0),
      scopes: (subject.scopes || []).map((scope) => ({
        scopeId: String(scope.scopeId),
        name: scope.name,
        semester: scope.semester,
        questionCount: Number(scope.questionCount || 0),
        roundCount: Number(scope.roundCount || 0),
        completedRounds: Number(scope.completedRounds || 0),
        ready: Boolean(scope.ready),
        entry: scope.entry || { mode: 'unavailable' }
      }))
    })),
    attempts: sortLatestFirst((data.attempts || []).map((item) => ({
      ...item,
      id: String(item.id),
      name: item.name || '测评记录',
      statusLabel: assessmentStatusLabel(item.status)
    })))
  }
}

async function loadCurrentDiagnosticReports() {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_DIAGNOSTIC_REPORTS
  ))
  if (data.status === 'unauthenticated') throw new Error('请先登录后查看诊断。')
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('诊断数据暂时不可用。')

  return {
    profile: data.profile,
    reports: (data.reports || []).map((item) => ({
      ...item,
      id: String(item.id),
      confidencePercent: item.confidence === null || item.confidence === undefined ? null : Math.round(Number(item.confidence) * 100),
      weakTopics: (item.weakTopics || []).map((topic) => typeof topic === 'string'
        ? { name: topic }
        : { ...topic, name: topic.name || topic.title || topic.topicName || topic.topic_code || '待确认知识点' })
    })),
    predictions: (data.predictions || []).map((item) => ({
      ...item,
      id: String(item.id),
      subjectName: subjectNames[item.subjectCode] || item.subjectCode || '综合',
      scoreRange: item.scoreLower === null || item.scoreLower === undefined || item.scoreUpper === null || item.scoreUpper === undefined
        ? '数据不足'
        : `${item.scoreLower} - ${item.scoreUpper}`,
      confidencePercent: item.confidence === null || item.confidence === undefined ? null : Math.round(Number(item.confidence) * 100)
    }))
  }
}

async function loadCurrentLearningPlans() {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLANS
  ))
  if (data.status === 'unauthenticated') throw new Error('请先登录后查看学习计划。')
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('学习计划暂时不可用。')

  return {
    profile: data.profile,
    plans: sortLatestFirst((data.plans || []).map((plan) => ({
      ...plan,
      id: String(plan.id),
      plannedCredits: plan.plannedCredits === null || plan.plannedCredits === undefined ? null : Number(plan.plannedCredits),
      items: (plan.items || []).map((item) => ({
        ...item,
        id: String(item.id),
        statusLabel: learningPlanItemStatusLabel(item.status),
        estimatedCredits: item.estimatedCredits === null || item.estimatedCredits === undefined ? null : Number(item.estimatedCredits),
        estimatedCreditsDisplay: item.estimatedCredits === null || item.estimatedCredits === undefined ? null : roundedCredits(item.estimatedCredits)
      }))
    })))
  }
}

function createCourseGenerationKey() {
  const random = typeof wx !== 'undefined' && typeof wx.getRandomValues === 'function'
    ? Array.from(wx.getRandomValues(new Uint32Array(2))).map((value) => value.toString(36)).join('')
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  return `course-generation-${Date.now().toString(36)}-${random}`
}

function courseGenerationError(code) {
  const messages = {
    AUTHENTICATION_REQUIRED: '请先登录后创建课程。',
    CURRENT_IDENTITY_NOT_INITIALIZED: '登录身份正在初始化，请稍后重试。',
    PROFILE_INCOMPLETE: '请先完成学习档案。',
    PLAN_ITEM_INVALID: '课程任务信息不正确。',
    PLAN_ITEM_NOT_FOUND: '未找到该学习任务，或当前账号无权操作。',
    PLAN_ITEM_LOCKED: '该任务尚未解锁，请先完成前置学习。',
    PLAN_NOT_ACTIVE: '该学习计划当前不可生成课程。',
    IDEMPOTENCY_KEY_INVALID: '请求标识无效，请重新进入页面后重试。',
    IDEMPOTENCY_KEY_CONFLICT: '该请求与之前的课程任务不一致，请重新进入页面。',
    PRICING_RULE_UNAVAILABLE: '课程积分计价规则暂未发布，请稍后重试。',
    PRICING_RULE_INVALID: '课程积分计价规则不完整，请联系管理员。',
    QUOTE_INVALID: '课程报价信息无效，请重新获取报价。',
    QUOTE_NOT_FOUND: '未找到该课程报价，请重新获取。',
    QUOTE_NOT_AVAILABLE: '该课程报价已使用，请重新获取。',
    QUOTE_EXPIRED: '课程报价已过期，请重新获取。',
    COURSE_ALREADY_REQUESTED: '该任务已创建课程，正在刷新生成状态。',
    COURSE_DISPATCH_UNCONFIRMED: '暂未确认课程服务收到请求，请稍后重试。',
    COURSE_DISPATCH_SNAPSHOT_INVALID: '课程生成请求记录异常，请联系管理员处理。',
    INSUFFICIENT_CREDITS: '课程积分不足，请先充值后再生成。',
    CREDIT_BALANCE_CHANGED: '课程积分已变动，请刷新后重新确认生成。'
  }
  return messages[code] || '课程生成请求失败，请稍后重试。'
}

function actionFlowBusinessCode(error) {
  const message = String(error && error.message || '')
  const codes = message.match(/[A-Z][A-Z0-9_]{2,}/g) || []
  return codes[codes.length - 1] || message
}

function courseGenerationFailure(error) {
  if (isAuthenticationRequired(error)) return error
  const code = error.code || actionFlowBusinessCode(error)
  return Object.assign(new Error(courseGenerationError(code)), { code })
}

async function courseOutlineRequest(action, payload = {}) {
  const token = await getRuntimeToken()
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/course-generation${action === 'read' ? `?course=${encodeURIComponent(payload.courseInstanceId)}` : ''}`,
    method: action === 'read' ? 'GET' : 'POST', timeout: 20000,
    header: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(action === 'read' ? {} : { data: { action, ...payload } }),
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请重新进入。'))
      if (response.statusCode >= 200 && response.statusCode < 300) return resolve(response.data)
      const code = response.data && response.data.code
      const messages = {
        OUTLINE_CONFLICT: '大纲已在其他页面更新，请重新读取后再编辑。',
        OUTLINE_ALREADY_CONFIRMED: '大纲已确认，课程正在生成。',
        OUTLINE_NOT_READY: '大纲尚未准备好，请稍后刷新。',
        OUTLINE_INVALID: '请检查标题、知识要点和章节设置，至少保留一章。',
        OUTLINE_TYPE_INVALID: '章节设置与所选类型不匹配，请重新选择后保存。',
        COURSE_GENERATION_NOT_FOUND: '课程任务正在同步，请稍后刷新。',
        COURSE_ACCESS_DENIED: '当前账号无法编辑此课程。',
        PLAN_ITEM_LOCKED: '学习任务状态已变化，请返回学习页刷新。',
        LOGIN_REQUIRED: '登录状态已失效，请重新登录。'
      }
      reject(Object.assign(new Error(messages[code] || '课程大纲服务暂不可用，请稍后重试。'), { code }))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}
async function prepareCourseOutlineReview(planItemId, correlationId) { return courseOutlineRequest('prepare', { planItemId: String(planItemId), correlationId }) }
async function loadCourseOutline(courseInstanceId) { return courseOutlineRequest('read', { courseInstanceId: String(courseInstanceId) }) }
async function saveCourseOutline(courseInstanceId, draft, confirm = false) { return courseOutlineRequest(confirm ? 'confirm' : 'save', { courseInstanceId: String(courseInstanceId), draft }) }
async function cancelCourseOutline(courseInstanceId) { return courseOutlineRequest('cancel', { courseInstanceId: String(courseInstanceId) }) }

async function createCurrentCourseGenerationQuote(planItemId, idempotencyKey) {
  const normalizedPlanItemId = Number(planItemId)
  if (!Number.isSafeInteger(normalizedPlanItemId) || normalizedPlanItemId <= 0) {
    throw new Error('课程任务信息不完整，请返回学习页后重试。')
  }
  const requestKey = String(idempotencyKey || createCourseGenerationKey()).trim()
  try {
    const data = parseActionFlowResult(await invokeActionFlow(
      config.ACTION_FLOWS.CREATE_CURRENT_COURSE_GENERATION_QUOTE,
      { plan_item_id: normalizedPlanItemId, idempotency_key: requestKey }
    ))
    if (data && data.status === 'already_requested') throw Object.assign(new Error('COURSE_ALREADY_REQUESTED'), { code: 'COURSE_ALREADY_REQUESTED' })
    if (!data || data.status !== 'quoted' || !Number.isSafeInteger(Number(data.quoteId))) {
      throw Object.assign(new Error('COURSE_QUOTE_REJECTED'), { code: data && data.status })
    }
    return {
      quoteId: String(data.quoteId),
      estimatedLowerCredits: Number(data.estimatedLowerCredits),
      estimatedUpperCredits: Number(data.estimatedUpperCredits),
      frozenTargetCredits: Number(data.frozenTargetCredits),
      expiresAt: data.expiresAt || '',
      reused: Boolean(data.reused)
    }
  } catch (error) {
    throw courseGenerationFailure(error)
  }
}

async function confirmCurrentCourseGeneration(quoteId, idempotencyKey) {
  const normalizedQuoteId = Number(quoteId)
  if (!Number.isSafeInteger(normalizedQuoteId) || normalizedQuoteId <= 0) {
    throw new Error('课程报价信息不完整，请重新获取报价。')
  }
  const requestKey = String(idempotencyKey || createCourseGenerationKey()).trim()
  try {
    const data = parseActionFlowResult(await invokeActionFlow(
      config.ACTION_FLOWS.CONFIRM_CURRENT_COURSE_GENERATION,
      { quote_id: normalizedQuoteId, idempotency_key: requestKey }
    ))
    if (!data || !['queued', 'reused'].includes(data.status) || !data.courseInstanceId || !data.generationJobId) {
      throw Object.assign(new Error('COURSE_CONFIRM_REJECTED'), { code: data && data.status })
    }
    return {
      status: data.status,
      reused: Boolean(data.reused),
      courseInstanceId: String(data.courseInstanceId),
      generationJobId: String(data.generationJobId),
      settlementId: data.settlementId ? String(data.settlementId) : '',
      frozenCredits: Number(data.frozenCredits || 0)
    }
  } catch (error) {
    throw courseGenerationFailure(error)
  }
}

async function loadCurrentRemediationTasks() {
  return parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_REMEDIATION_TASKS
  ))
}

async function loadCurrentLiveSchedule() {
  const data = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_LIVE_SCHEDULE
  ))

  if (!data || typeof data !== 'object') {
    throw new Error('真人陪跑日程返回的数据格式不正确。')
  }
  if (data.status === 'unauthenticated') throw new Error('请先登录后查看真人陪跑日程。')
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('真人陪跑日程暂时不可用。')

  return {
    profile: data.profile || null,
    sessions: Array.isArray(data.sessions) ? data.sessions : [],
    assignments: Array.isArray(data.assignments) ? data.assignments : []
  }
}

function normalizeCandidateTopicId(topicId) {
  const value = Number(topicId)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('知识点信息不完整，请返回图谱后重试。')
  }
  return value
}

function normalizeLearningPlanCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return null
  const topicId = Number(candidate.topicId)
  if (!Number.isSafeInteger(topicId) || topicId <= 0) return null
  return {
    id: candidate.id == null ? '' : String(candidate.id),
    topicId: String(topicId),
    topicName: String(candidate.topicName || ''),
    subjectKey: String(candidate.subjectKey || ''),
    subjectName: String(candidate.subjectName || ''),
    status: String(candidate.status || ''),
    source: String(candidate.source || ''),
    createdAt: candidate.createdAt || ''
  }
}

async function loadCurrentTopicCandidates() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_LEARNING_PLAN_CANDIDATES
  )) || {}
  const status = String(payload.status || 'unavailable')
  return {
    status,
    candidates: (payload.candidates || []).map(normalizeLearningPlanCandidate).filter(Boolean)
  }
}

async function addCurrentTopicCandidate(topicId) {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.ADD_CURRENT_LEARNING_PLAN_CANDIDATE,
    { topic_id: normalizeCandidateTopicId(topicId) }
  )) || {}
  const status = String(payload.status || 'unavailable')
  const messages = {
    unauthenticated: '请先登录后加入候选。',
    profile_incomplete: '请先完善学习档案后加入候选。',
    invalid_topic: '知识点信息不完整，请返回图谱后重试。',
    topic_unavailable: '该知识点暂不可加入候选。',
    topic_out_of_scope: '该知识点不在当前年级学习范围内。'
  }
  if (!['added', 'reactivated', 'already_active'].includes(status)) {
    throw new Error(messages[status] || '加入候选失败，请稍后重试。')
  }
  return { status, candidate: normalizeLearningPlanCandidate(payload.candidate) }
}

async function removeCurrentTopicCandidate(topicId) {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.REMOVE_CURRENT_LEARNING_PLAN_CANDIDATE,
    { topic_id: normalizeCandidateTopicId(topicId) }
  )) || {}
  const status = String(payload.status || 'unavailable')
  const messages = {
    unauthenticated: '请先登录后管理候选。',
    profile_incomplete: '请先完善学习档案后管理候选。',
    invalid_topic: '知识点信息不完整，请返回图谱后重试。'
  }
  if (!['removed', 'not_found'].includes(status)) {
    throw new Error(messages[status] || '移出候选失败，请稍后重试。')
  }
  return { status }
}

async function loadCurrentServiceContacts() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_SERVICE_CONTACTS
  )) || {}

  if (payload.status === 'unauthenticated') throw new Error('请先登录后查看真人服务。')
  if (payload.status === 'profile_incomplete') {
    return { status: 'profile_incomplete', contacts: [] }
  }
  if (!['ready', 'no_active_contacts'].includes(payload.status)) {
    throw new Error('真人服务暂时无法读取，请稍后重试。')
  }

  const contacts = (Array.isArray(payload.contacts) ? payload.contacts : [])
    .filter((item) => item && item.id && item.contactType === 'enterprise_wechat_link' && isEnterpriseWechatContact(item))
    .map((item) => ({
      id: String(item.id),
      contactType: item.contactType,
      title: String(item.title || '真人服务').trim().slice(0, 80) || '真人服务',
      corpId: String(item.corpId).trim(),
      targetRef: String(item.targetRef).trim()
    }))

  return { status: contacts.length ? 'ready' : payload.status, contacts }
}

// 老师工作台只认后台开通的有效老师档案；not_teacher / 未登录都按「不是老师」处理，入口不显示。
async function loadCurrentTeacherWorkspace() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_TEACHER_WORKSPACE
  )) || {}

  if (['not_teacher', 'unauthenticated', 'not_initialized'].includes(payload.status)) {
    return { status: 'not_teacher', teacher: null, students: [] }
  }
  if (payload.status !== 'ready' || !payload.teacher) {
    throw new Error('老师工作台暂时无法读取，请稍后重试。')
  }

  const students = (Array.isArray(payload.students) ? payload.students : [])
    .filter((item) => item && item.studentProfileId)
    .map((item) => ({
      bindingId: String(item.bindingId || item.studentProfileId),
      studentProfileId: String(item.studentProfileId),
      name: String(item.name || '未命名学生').trim().slice(0, 40) || '未命名学生',
      grade: item.grade || null,
      publicId: String(item.publicId || ''),
      avatarUrl: String(item.avatarUrl || ''),
      boundAt: item.boundAt || ''
    }))

  return {
    status: 'ready',
    teacher: {
      id: String(payload.teacher.id || ''),
      name: String(payload.teacher.name || '老师').trim().slice(0, 40) || '老师',
      teacherNo: String(payload.teacher.teacherNo || '')
    },
    students
  }
}

// 老师凭学生的 6 位用户 ID 把学生加到自己名下；后端只认当前登录的有效老师，不能替他人操作。
async function bindStudentAsCurrentTeacher(publicId) {
  const code = String(publicId || '').trim()
  if (!/^\d{6}$/.test(code)) throw new Error('请输入学生的 6 位用户 ID')
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.BIND_STUDENT_AS_CURRENT_TEACHER,
    { publicId: code }
  )) || {}
  const status = String(payload.status || 'unavailable')
  if (status === 'bound' || status === 'already_bound') {
    const student = payload.student || {}
    return {
      status,
      student: status === 'bound' ? {
        name: String(student.name || '未命名学生').trim().slice(0, 40) || '未命名学生',
        grade: student.grade || null,
        publicId: String(student.publicId || code)
      } : null
    }
  }
  const messages = {
    unauthenticated: '请先登录后再添加学生。',
    not_initialized: '请先完成账号初始化。',
    not_teacher: '只有服务老师可以添加学生。',
    invalid_code: '请输入学生的 6 位用户 ID',
    code_not_found: '没有找到这个用户 ID 对应的学生，请核对后重试。',
    self_binding_forbidden: '不能把自己添加为学生。'
  }
  throw Object.assign(new Error(messages[status] || '添加学生失败，请稍后重试。'), { code: status })
}

// 老师侧的学生服务：读写绑定学生的学习档案、发起智能体邀请。
// 后端「教师学生服务」按当前登录账号判定教师身份与绑定关系，前端传入的学生 id 只是目标，不是凭据。
function teacherStudentFlow() {
  const flow = config.ACTION_FLOWS.TEACHER_STUDENT_SERVICE
  if (!flow || !flow.id) {
    throw new Error('教师学生服务尚未部署，请先运行 scripts/mp-teacher/deploy-teacher-student-flow.mjs。')
  }
  return flow
}

const TEACHER_STUDENT_MESSAGES = {
  unauthenticated: '请先登录后再操作。',
  not_initialized: '请先完成账号初始化。',
  not_teacher: '只有服务老师可以查看和修改学生档案。',
  invalid_meeting_minutes: '会议时长需在 5 分钟到 8 小时之间。',
  attempt_not_found: '没有找到这次测评，可能不属于这位学生。',
  invalid_attempt: '测评记录无效，请返回重试。',
  invalid_student: '学生信息不完整，请返回工作台重试。',
  student_not_bound: '这名学生已不在你的名下。',
  student_not_found: '没有找到这名学生的档案。',
  invalid_profile: '请检查填写的内容。',
  invalid_nickname: '请填写学生称呼。',
  invalid_grade: '年级需要在 1 到 12 之间。',
  invalid_school_stage: '请选择有效的学段。',
  invalid_semester: '请选择有效的学期。',
  invalid_textbook_version: '请选择有效的教材版本。',
  empty_profile: '没有需要保存的改动。',
  invalid_invite: '预约信息不完整，请刷新后重试。',
  invite_not_found: '没有找到这条预约。',
  invite_already_canceled: '这条预约已经取消过了。',
  invalid_voice_file: '语音上传失败，请重新录制。',
  invalid_voice_duration: '语音需要在 1 秒到 10 分钟之间。',
  unsupported_operation: '暂不支持这个操作。',
  INVALID_REQUEST: '请求格式不正确。'
}

function normalizeTeacherStudentProfile(profile) {
  const value = profile || {}
  return {
    studentProfileId: String(value.studentProfileId || ''),
    nickname: String(value.nickname || ''),
    displayName: String(value.displayName || '未命名学生'),
    grade: value.grade === null || value.grade === undefined ? null : Number(value.grade),
    schoolStage: String(value.schoolStage || ''),
    semester: String(value.semester || ''),
    schoolName: String(value.schoolName || ''),
    textbookVersion: String(value.textbookVersion || ''),
    regionDetail: String(value.regionDetail || ''),
    profileCompleted: Boolean(value.profileCompleted),
    // 学生头像：带签名的临时地址，只用于老师端学生详情头部。
    avatarUrl: /^https:\/\//.test(String(value.avatarUrl || '')) ? String(value.avatarUrl) : '',
    updatedAt: value.updatedAt || ''
  }
}

function normalizeTeacherAgentInvite(invite) {
  const value = invite || {}
  return {
    inviteId: String(value.inviteId || ''),
    subject: String(value.subject || ''),
    scheduledOnlineAt: value.scheduledOnlineAt || '',
    status: String(value.status || ''),
    token: String(value.token || ''),
    hasSession: Boolean(value.hasSession),
    createdAt: value.createdAt || '',
    // 课前语音：老师必须先录一段，学生进入对话时由 AI 客服先播这段。
    hasVoice: Boolean(value.hasVoice),
    voiceDurationMs: Number(value.voiceDurationMs || 0),
    // 会议时长（分钟）与预约说明：2026-09-24 新增，老预约为空。
    meetingMinutes: Number(value.meetingMinutes || 0),
    meetingNote: String(value.meetingNote || ''),
    // 一个学生同时只有最后发起的那条预约生效，后端算好后下发。
    isLatest: Boolean(value.isLatest),
    effective: Boolean(value.effective),
    supersededBy: String(value.supersededBy || '')
  }
}

function teacherStudentError(status) {
  return Object.assign(new Error(TEACHER_STUDENT_MESSAGES[status] || '操作失败，请稍后重试。'), { code: status })
}

async function invokeTeacherStudentService(payload) {
  return parseActionFlowResult(await invokeActionFlow(teacherStudentFlow(), { payload })) || {}
}

async function loadTeacherStudentProfile(studentProfileId) {
  const result = await invokeTeacherStudentService({ operation: 'student.profile.get', studentProfileId: String(studentProfileId || '') })
  if (result.status !== 'ready') throw teacherStudentError(String(result.status || 'unavailable'))
  return {
    profile: normalizeTeacherStudentProfile(result.profile),
    invites: (Array.isArray(result.invites) ? result.invites : []).map(normalizeTeacherAgentInvite),
    serverNow: result.serverNow || ''
  }
}

// 老师查看负责学生的测评记录（「教师学生服务」student.assessments.list / student.assessment.read，只读）。
async function loadTeacherStudentAssessments(studentProfileId) {
  const result = await invokeTeacherStudentService({ operation: 'student.assessments.list', studentProfileId: String(studentProfileId || '') })
  if (result.status !== 'ready') throw teacherStudentError(String(result.status || 'unavailable'))
  return (Array.isArray(result.attempts) ? result.attempts : []).map((item) => ({
    attemptId: String(item.attemptId || ''),
    status: String(item.status || ''),
    name: String(item.name || '测评记录'),
    round: Number(item.round || 1),
    roundCount: Number(item.roundCount || 1),
    startedAt: String(item.startedAt || ''),
    submittedAt: String(item.submittedAt || ''),
    band: String(item.band || ''),
    correctCount: Number(item.correctCount || 0),
    answeredCount: Number(item.answeredCount || 0),
    earnedMarks: Number(item.earnedMarks || 0),
    possibleMarks: Number(item.possibleMarks || 0)
  })).filter((item) => /^[1-9][0-9]*$/.test(item.attemptId))
}

async function loadTeacherStudentAssessment(studentProfileId, attemptId) {
  const result = await invokeTeacherStudentService({ operation: 'student.assessment.read', studentProfileId: String(studentProfileId || ''), attemptId: String(attemptId || '') })
  if (result.status !== 'ready' || !result.attempt) throw teacherStudentError(String(result.status || 'unavailable'))
  return result.attempt
}

async function saveTeacherStudentProfile(studentProfileId, profile) {
  const result = await invokeTeacherStudentService({
    operation: 'student.profile.save',
    studentProfileId: String(studentProfileId || ''),
    profile: profile || {}
  })
  if (result.status !== 'saved') throw teacherStudentError(String(result.status || 'unavailable'))
  return {
    profile: normalizeTeacherStudentProfile(result.profile),
    invites: (Array.isArray(result.invites) ? result.invites : []).map(normalizeTeacherAgentInvite)
  }
}

// 老师课前语音：先把录音传进 Zion 文件存储拿到 fileId，再挂到这条预约上。
// 与验收录音同一套上传通道（私有 ACL），学生端播放时由后端签发临时地址。
async function uploadTeacherInviteVoice(filePath, durationMs) {
  const normalizedDuration = Number(durationMs)
  if (!filePath || !Number.isFinite(normalizedDuration) || normalizedDuration < 1000) {
    throw new Error('录音时间过短，请至少说 1 秒。')
  }
  if (normalizedDuration > 10 * 60 * 1000) throw new Error('语音最长 10 分钟，请重新录制。')

  const info = await getLocalFileInfo(filePath)
  const sizeBytes = Number(info.size || 0)
  if (!sizeBytes || sizeBytes > 25 * 1024 * 1024) {
    throw new Error('录音文件必须在 25MB 以内，请重新录制。')
  }
  const audio = getAudioFormat(filePath)
  const uploadData = await graphql(
    `mutation GetInviteVoiceUploadUrl(
      $md5: String!,
      $format: MediaFormat!,
      $name: String!,
      $suffix: String!,
      $sizeBytes: Int!,
      $acl: CannedAccessControlList!
    ) {
      filePresignedUrl(
        md5Base64: $md5,
        format: $format,
        name: $name,
        suffix: $suffix,
        sizeBytes: $sizeBytes,
        acl: $acl
      ) {
        fileId uploadUrl uploadHeaders
      }
    }`,
    {
      md5: md5HexToBase64(info.digest),
      format: audio.format,
      name: `teacher-invite-voice-${Date.now()}.${audio.fileFormat}`,
      suffix: audio.suffix,
      sizeBytes,
      acl: 'PRIVATE'
    }
  )
  const presigned = uploadData && uploadData.filePresignedUrl
  if (!presigned || !presigned.fileId || !presigned.uploadUrl) {
    throw new Error('未获取到语音上传凭证，请稍后重试。')
  }
  const content = await readLocalFile(filePath)
  await putBinary(presigned.uploadUrl, presigned.uploadHeaders, content.data)
  return { fileId: String(presigned.fileId), sizeBytes, durationMs: Math.round(normalizedDuration) }
}

/** 预约创建后补写会议时长（分钟，5–480）与预约说明（≤60 字）。 */
async function saveTeacherInviteDetails(studentProfileId, inviteId, meetingMinutes, meetingNote = '') {
  const result = await invokeTeacherStudentService({
    operation: 'invite.details.save',
    studentProfileId: String(studentProfileId || ''),
    inviteId: String(inviteId || ''),
    meetingMinutes: Math.round(Number(meetingMinutes) || 0),
    meetingNote: String(meetingNote || '').trim().slice(0, 60)
  })
  if (result.status !== 'details_saved') throw teacherStudentError(String(result.status || 'unavailable'))
  return {
    profile: normalizeTeacherStudentProfile(result.profile),
    invites: (Array.isArray(result.invites) ? result.invites : []).map(normalizeTeacherAgentInvite)
  }
}

async function saveTeacherInviteVoice(studentProfileId, inviteId, voiceFileId, voiceDurationMs) {
  const result = await invokeTeacherStudentService({
    operation: 'invite.voice.save',
    studentProfileId: String(studentProfileId || ''),
    inviteId: String(inviteId || ''),
    voiceFileId: String(voiceFileId || ''),
    voiceDurationMs: Math.round(Number(voiceDurationMs) || 0)
  })
  if (result.status !== 'voice_saved') throw teacherStudentError(String(result.status || 'unavailable'))
  return {
    profile: normalizeTeacherStudentProfile(result.profile),
    invites: (Array.isArray(result.invites) ? result.invites : []).map(normalizeTeacherAgentInvite)
  }
}

// 取消预约：取消最新那条后，之前发出去的所有分享链接一起失效（后端按「只有最新一条生效」判定）。
async function cancelTeacherAgentInvite(studentProfileId, inviteId) {
  const result = await invokeTeacherStudentService({
    operation: 'invite.cancel',
    studentProfileId: String(studentProfileId || ''),
    inviteId: String(inviteId || '')
  })
  if (result.status !== 'canceled') throw teacherStudentError(String(result.status || 'unavailable'))
  return {
    profile: normalizeTeacherStudentProfile(result.profile),
    invites: (Array.isArray(result.invites) ? result.invites : []).map(normalizeTeacherAgentInvite)
  }
}

// 发起预约：后端校验「当前登录者是有效老师」且「该学生与其有 active 绑定」后才会生成 share_token。
async function createTeacherAgentInvite({ studentProfileId, subjectLabel, scheduledOnlineAt }) {
  const subject = String(subjectLabel || '').trim()
  if (!subject) throw Object.assign(new Error('请选择本次陪跑的学科。'), { code: 'invalid_subject' })
  const when = new Date(scheduledOnlineAt)
  if (!scheduledOnlineAt || Number.isNaN(when.getTime())) {
    throw Object.assign(new Error('请选择有效的上线时间。'), { code: 'invalid_schedule' })
  }
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CREATE_TEACHER_AGENT_INVITE,
    { studentProfileId: String(studentProfileId || ''), subjectLabel: subject, scheduledOnlineAt: when.toISOString() }
  )) || {}
  if (payload.status === 'created' && payload.invite) {
    const invite = payload.invite
    return {
      inviteId: String(invite.inviteId || ''),
      token: String(invite.token || ''),
      subject: String(invite.subject || subject),
      scheduledOnlineAt: invite.scheduledOnlineAt || when.toISOString(),
      status: String(invite.status || 'scheduled'),
      studentProfileId: String(invite.studentProfileId || studentProfileId || ''),
      studentName: String(invite.studentName || ''),
      teacherName: String(invite.teacherName || '老师'),
      createdAt: invite.createdAt || ''
    }
  }
  const messages = {
    unauthenticated: '请先登录后再发起预约。',
    not_initialized: '请先完成账号初始化。',
    not_teacher: '只有服务老师可以发起预约。',
    invalid_student: '学生信息不完整，请返回工作台重试。',
    invalid_subject: '请选择本次陪跑的学科。',
    invalid_schedule: '请选择有效的上线时间。',
    student_not_bound: '这名学生已不在你的名下。'
  }
  throw Object.assign(new Error(messages[payload.status] || '发起预约失败，请稍后重试。'), { code: String(payload.status || 'unavailable') })
}

// 学生本人打开分享页时读取邀请；后端只允许被邀请的学生本人读取，老师和家长都会拿到 not_your_invite。
async function loadTeacherAgentInvite(token) {
  const shareToken = String(token || '').trim()
  if (!shareToken) throw Object.assign(new Error('邀请链接不完整。'), { code: 'not_found' })
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_TEACHER_AGENT_INVITE,
    { token: shareToken }
  )) || {}
  if (payload.status === 'ready' && payload.invite) {
    const invite = payload.invite
    return {
      status: 'ready',
      online: Boolean(payload.online),
      // 'student' 学生本人 / 'guardian' 绑定了这名学生的家长（只能旁听）
      viewer: String(payload.viewer || 'student'),
      // 已结束的会议照样返回 ready：前端打开成只读的历史记录
      closed: Boolean(payload.closed),
      closedReason: String(payload.closedReason || ''),
      closedAt: String(payload.closedAt || ''),
      serverNow: payload.serverNow || '',
      invite: {
        inviteId: String(invite.inviteId || ''),
        token: String(invite.token || shareToken),
        subject: String(invite.subject || ''),
        scheduledOnlineAt: invite.scheduledOnlineAt || '',
        status: String(invite.status || ''),
        sessionId: String(invite.sessionId || ''),
        teacherName: String(invite.teacherName || '老师'),
        // 老师的头像来自他自己的用户资料，学生端会议页与诊断室都要用
        teacherAvatarUrl: String(invite.teacherAvatarUrl || ''),
        voiceUrl: String(invite.voiceUrl || ''),
        voiceDurationMs: Number(invite.voiceDurationMs || 0)
      }
    }
  }
  return {
    status: String(payload.status || 'unavailable'),
    online: false,
    serverNow: payload.serverNow || '',
    // 会议已结束时后端会带上原因：学生换设备打开看到的也是同一句话
    closedReason: String(payload.closedReason || ''),
    closedAt: String(payload.closedAt || ''),
    invite: null
  }
}

// 学生开始学习后把 OpenMAIC 会话回写到邀请上；失败不影响学习本身，由调用方决定是否忽略。
async function markTeacherAgentSession(token, sessionId) {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.MARK_TEACHER_AGENT_SESSION,
    { token: String(token || '').trim(), sessionId: String(sessionId || '').trim() }
  )) || {}
  return { status: String(payload.status || 'unavailable'), sessionId: String(payload.sessionId || '') }
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function generateCurrentLearningPlan({ goal, dailyMinutes, targetDate, subjectPriorities }, onProgress) {
  const data = await graphql(
    `mutation CreateLearningPlanTask($args: Json!) {
      taskId: fz_create_action_flow_task(
        actionFlowId: "${config.ACTION_FLOWS.GENERATE_CURRENT_LEARNING_PLAN.id}"
        args: $args
      )
    }`,
    {
      args: {
        goal: String(goal || '').trim(),
        daily_minutes: Number(dailyMinutes),
        target_date: String(targetDate || ''),
        subject_priorities: Array.isArray(subjectPriorities) ? subjectPriorities : []
      }
    }
  )

  const taskId = data && data.taskId
  if (taskId === null || taskId === undefined) throw new Error('学习计划任务没有成功创建。')

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const result = await graphql(
      `query GetLearningPlanTask($taskId: Long!) {
        task: fz_action_flow_result(taskId: $taskId) { status output }
      }`,
      { taskId: Number(taskId) }
    )
    const task = result && result.task
    const status = task && task.status || 'CREATED'
    if (typeof onProgress === 'function') onProgress(status)

    if (status === 'COMPLETED') {
      const output = parseActionFlowResult(task.output)
      if (!output || output.status !== 'ready' || !output.planId) {
        throw new Error('学习计划没有生成成功。')
      }
      return output
    }
    if (status === 'FAILED') {
      const output = task && task.output
      const detail = typeof output === 'string' ? output : ''
      throw new Error(detail || '学习计划生成失败，请调整条件后重试。')
    }
    await sleep(2500)
  }

  throw new Error('学习计划仍在生成中，请稍后在学习计划中查看。')
}

async function startOrResumeBasicAssessment(subjectKey, targetExam = '') {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.START_OR_RESUME_BASIC_ASSESSMENT,
    { subject_key: subjectKey, target_exam: String(targetExam || '') }
  ))
  if (data.status === 'template_unavailable') throw new Error('该学科暂未发布可用测评。')
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('暂时无法开始测评，请稍后重试。')
  return data
}

async function saveCurrentAssessmentAnswer(attemptId, questionId, answer) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_ANSWER,
    { attempt_id: Number(attemptId), question_id: Number(questionId), answer }
  ))
  if (data.status !== 'saved') throw new Error('答案暂未保存，请重试。')
  return data.answer
}

async function submitCurrentBasicAssessment(attemptId) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.SUBMIT_CURRENT_BASIC_ASSESSMENT,
    { attempt_id: Number(attemptId) }
  ))
  if (data.status === 'incomplete') return data
  if (data.status !== 'submitted') throw new Error('提交失败，请稍后重试。')
  return data
}

async function loadCurrentAssessmentScores(attemptId) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_ASSESSMENT_SCORES,
    { attempt_id: Number(attemptId) }
  ))
  if (data.status === 'profile_incomplete') throw new Error('请先完善学习档案。')
  if (data.status !== 'ready') throw new Error('未找到本次测评记录。')
  return (data.uploads || []).map((item) => ({
    ...item,
    id: String(item.id),
    score: item.score === null || item.score === undefined ? '' : String(item.score),
    fullScore: item.full_score === null || item.full_score === undefined ? '' : String(item.full_score),
    examName: item.exam_name || '',
    examDate: item.exam_date || '',
    rankText: item.rank_text || '',
    originalFiles: normalizeAssessmentFiles(item.original_files),
    ocrRaw: normalizeJsonValue(item.ocr_raw),
    ocrCorrected: normalizeJsonValue(item.ocr_corrected),
    ocrConfidence: item.ocr_confidence === null || item.ocr_confidence === undefined ? null : Number(item.ocr_confidence)
  }))
}

async function saveCurrentAssessmentScore(attemptId, form) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_SCORE,
    {
      attempt_id: Number(attemptId),
      upload_id: form.id ? Number(form.id) : null,
      exam_name: String(form.examName || '').trim(),
      exam_date: String(form.examDate || '').trim(),
      score: Number(form.score),
      full_score: Number(form.fullScore),
      rank_text: String(form.rankText || '').trim()
    }
  ))
  const messages = {
    invalid_exam: '请填写有效的考试名称和日期。',
    invalid_score: '得分应在 0 到满分之间。',
    duplicate_exam: '这场考试已经记录过，请直接修改原记录。'
  }
  if (data.status !== 'saved') throw new Error(messages[data.status] || '成绩保存失败，请重试。')
  return data.upload
}

function normalizeAssessmentFiles(value) {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch (error) {
      value = []
    }
  }

  return (Array.isArray(value) ? value : [])
    .map((item, index) => ({
      pageNo: Number(item && item.pageNo) || index + 1,
      assetId: String((item && item.assetId) || ''),
      name: String((item && item.name) || `试卷第 ${index + 1} 页`),
      sizeBytes: Number((item && item.sizeBytes) || 0),
      md5Base64: String((item && item.md5Base64) || ''),
      suffix: String((item && item.suffix) || '').toUpperCase(),
      uploadedAt: (item && item.uploadedAt) || ''
    }))
    .filter((item) => item.assetId)
    .sort((a, b) => a.pageNo - b.pageNo)
}

function normalizeJsonValue(value) {
  if (typeof value !== 'string') return value || null
  try {
    return JSON.parse(value)
  } catch (error) {
    return null
  }
}

function getLocalFileInfo(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileInfo({ filePath, digestAlgorithm: 'md5', success: resolve, fail: reject })
  })
}

function readLocalFile(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({ filePath, success: resolve, fail: reject })
  })
}

function getLocalImageInfo(filePath) {
  return new Promise((resolve) => {
    wx.getImageInfo({ src: filePath, success: resolve, fail: () => resolve({}) })
  })
}

function putBinary(url, header, data) {
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      method: 'PUT',
      data,
      header: header || {},
      success: (response) => response.statusCode >= 200 && response.statusCode < 300
        ? resolve()
        : reject(new Error(`图片上传失败（${response.statusCode}）`)),
      fail: reject
    })
  })
}

// 私有文件上传（推广结算的发票等，2026-09-26）：PDF 或常见图片，传到 Zion 私有存储，返回文件 id。
// 读取时由动作流给约两天有效的签名地址；小程序本地不留地址。
const PRIVATE_FILE_FORMATS = { pdf: 'PDF', jpg: 'JPG', jpeg: 'JPEG', png: 'PNG', webp: 'WEBP' }

function privateFileExtension(value) {
  const match = /\.([A-Za-z0-9]+)$/.exec(String(value || '').split('?')[0])
  return match ? match[1].toLowerCase() : ''
}

async function uploadPrivateFile(filePath, { name = '', maxBytes = 10 * 1024 * 1024 } = {}) {
  const extension = privateFileExtension(name) || privateFileExtension(filePath)
  const format = PRIVATE_FILE_FORMATS[extension]
  if (!filePath || !format) throw new Error('只支持 PDF、JPG、PNG 格式的文件。')
  const info = await getLocalFileInfo(filePath)
  const sizeBytes = Number(info.size || 0)
  if (!sizeBytes) throw new Error('文件是空的，请重新选择。')
  if (sizeBytes > maxBytes) throw new Error(`单个文件不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB。`)
  const md5Base64 = md5HexToBase64(info.digest)
  const fileName = String(name || '').trim().slice(0, 80) || `file-${Date.now()}.${extension}`
  const uploadData = await graphql(
    `mutation GetPrivateFileUploadUrl(
      $md5: String!,
      $format: MediaFormat!,
      $name: String!,
      $suffix: String!,
      $sizeBytes: Int!,
      $acl: CannedAccessControlList!
    ) {
      filePresignedUrl(md5Base64: $md5, format: $format, name: $name, suffix: $suffix, sizeBytes: $sizeBytes, acl: $acl) {
        fileId uploadUrl uploadHeaders
      }
    }`,
    { md5: md5Base64, format, name: fileName, suffix: extension, sizeBytes, acl: 'PRIVATE' }
  )
  const presigned = uploadData && uploadData.filePresignedUrl
  if (!presigned || !presigned.fileId || !presigned.uploadUrl) throw new Error('未获取到文件上传凭证，请稍后重试。')
  const content = await readLocalFile(filePath)
  await putBinary(presigned.uploadUrl, presigned.uploadHeaders, content.data)
  return { fileId: String(presigned.fileId), name: fileName, format: extension === 'jpeg' ? 'jpg' : extension, sizeBytes }
}

function getImageSuffix(filePath) {
  const extension = String(filePath || '').split('.').pop().toUpperCase()
  if (extension === 'JPEG') return 'JPEG'
  if (extension === 'PNG') return 'PNG'
  if (extension === 'WEBP') return 'WEBP'
  return 'JPG'
}

function md5HexToBase64(hex) {
  const normalized = String(hex || '').trim()
  if (!/^[a-fA-F0-9]{32}$/.test(normalized)) {
    throw new Error('无法校验图片文件，请重新选择。')
  }
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16)
  }
  return wx.arrayBufferToBase64(bytes.buffer)
}

async function uploadAssessmentImage(filePath, index) {
  const info = await getLocalFileInfo(filePath)
  const sizeBytes = Number(info.size || 0)
  if (!sizeBytes || sizeBytes > 10 * 1024 * 1024) {
    throw new Error('单张试卷图片不能超过 10MB。')
  }
  const dimensions = await getLocalImageInfo(filePath)
  if (!dimensions.width || !dimensions.height || Math.min(dimensions.width, dimensions.height) < 600) {
    throw new Error('图片不够清晰，请重拍完整试卷。')
  }
  const suffix = getImageSuffix(filePath)
  const md5Base64 = md5HexToBase64(info.digest)
  const data = await graphql(
    `mutation GetAssessmentImageUploadUrl($md5: String!, $suffix: MediaFormat!, $acl: CannedAccessControlList!) {
      imagePresignedUrl(imgMd5Base64: $md5, imageSuffix: $suffix, acl: $acl) {
        imageId uploadUrl uploadHeaders
      }
    }`,
    { md5: md5Base64, suffix, acl: 'PRIVATE' }
  )
  const presigned = data && data.imagePresignedUrl
  if (!presigned || !presigned.imageId || !presigned.uploadUrl) {
    throw new Error('未获取到图片上传凭证，请稍后重试。')
  }
  const content = await readLocalFile(filePath)
  await putBinary(presigned.uploadUrl, presigned.uploadHeaders, content.data)
  return {
    pageNo: Number(index) + 1,
    assetId: String(presigned.imageId),
    name: `试卷第 ${Number(index) + 1} 页`,
    sizeBytes,
    md5Base64,
    suffix,
    width: Number(dimensions.width || 0),
    height: Number(dimensions.height || 0),
    uploadedAt: new Date().toISOString()
  }
}

async function saveCurrentAssessmentExamFiles(attemptId, form, files) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_EXAM_FILES,
    {
      attempt_id: Number(attemptId),
      upload_id: form.id ? Number(form.id) : null,
      exam_name: String(form.examName || '').trim(),
      exam_date: String(form.examDate || '').trim(),
      original_files: normalizeAssessmentFiles(files)
    }
  ))
  const messages = {
    invalid_exam: '请填写有效的试卷名称和日期。',
    invalid_files: '请保留 1 至 10 张有效的试卷图片。',
    duplicate_exam: '这场考试已经记录过，请选择原记录后继续上传。'
  }
  if (data.status !== 'saved') throw new Error(messages[data.status] || '试卷文件保存失败，请重试。')
  return data.upload
}

async function saveCurrentAssessmentOcrReview(attemptId, uploadId, corrected) {
  const data = parseAssessmentResult(await invokeActionFlow(
    config.ACTION_FLOWS.SAVE_CURRENT_ASSESSMENT_OCR_REVIEW,
    {
      attempt_id: Number(attemptId),
      upload_id: Number(uploadId),
      ocr_corrected: corrected
    }
  ))
  const messages = {
    invalid_ocr: '校对内容格式不正确。',
    ocr_unavailable: '当前试卷还没有可校对的识别结果。'
  }
  if (data.status !== 'saved') throw new Error(messages[data.status] || 'OCR 校对保存失败，请重试。')
  return data.upload
}

function graphPosition(index, total, centrality) {
  const angle = index * 2.399963229728653
  const radius = 210 + Math.sqrt(index + 1) * 132 + Math.min(0.16, Number(centrality) || 0) * 620
  return {
    x: Math.round(1160 + Math.cos(angle) * radius),
    y: Math.round(1020 + Math.sin(angle) * radius)
  }
}

function edgeStyle(from, to) {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const length = Math.max(1, Math.round(Math.sqrt(dx * dx + dy * dy)))
  const angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI)
  return `left:${from.x}rpx;top:${from.y}rpx;width:${length}rpx;transform:rotate(${angle}deg);`
}

function buildKnowledgeMap(payload, selectedSubjectKey) {
  if (!payload || payload.status === 'unauthenticated') throw new Error('请先登录后查看知识图谱。')
  if (payload.status === 'dataset_unavailable') throw new Error('知识库正在准备，请稍后重试。')
  if (payload.status === 'semester_required') throw new Error('请在个人资料中选择上学期或下学期并保存。')
  if (payload.status !== 'ready') throw createProfileRequiredError()
  if (payload.datasetKey !== 'china-k12-tokenmap-135386badef4') throw new Error('知识图谱数据源不匹配，请更新后重试。')

  const subjects = (payload.subjects || []).slice().sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0))
  const activeSubject = subjects.find((item) => item.subject_key === selectedSubjectKey) || subjects.find((item) => item.subject_key === 'math') || subjects[0]
  const activeSubjectKey = activeSubject && activeSubject.subject_key
  const topics = (payload.topics || []).filter((item) => item.subject_id === (activeSubject && activeSubject.id))
  const masteryByTopic = {}
  ;(payload.masteries || []).forEach((item) => { masteryByTopic[item.knowledge_topic_id] = item })

  const nodes = topics.map((topic, index) => {
    const mastery = masteryByTopic[topic.id]
    const state = graphStatus(mastery)
    const position = graphPosition(index, topics.length, topic.centrality)
    const score = Number(topic.centrality || 0)
    return {
      id: String(topic.id),
      label: topic.display_name,
      shortLabel: String(topic.display_name || '').slice(0, 8),
      description: topic.description || '',
      masteryStandard: topic.mastery_standard || '',
      grade: topic.grade_start,
      semester: topic.semester || '',
      x: position.x,
      y: position.y,
      size: Math.round(Math.min(210, Math.max(132, 132 + score * 420))),
      minHeight: Math.round(Math.min(132, Math.max(92, (132 + score * 420) * 0.62))),
      layout: { x: position.x, y: position.y, level: 0 },
      status: state.key,
      statusLabel: state.label,
      assessmentEvidenceCount: Number(mastery && mastery.assessment_evidence_count || 0),
      courseEvidenceCount: Number(mastery && mastery.course_evidence_count || 0),
      teacherEvidenceCount: Number(mastery && mastery.teacher_evidence_count || 0),
      masterySource: String(mastery && mastery.mastery_source || 'none'),
      evidence: mastery && Number(mastery.evidence_count) > 0
        ? `已汇集 ${mastery.evidence_count} 条学习证据 · 测评 ${Number(mastery.assessment_evidence_count || 0)} · 课程 ${Number(mastery.course_evidence_count || 0)}`
        : '尚无测评或课程学习证据',
      contribution: mastery && mastery.contribution ? `参考权重 ${mastery.contribution.marks} 分 · ${mastery.contribution.estimate === null ? '待测' : `已测部分贡献 ${mastery.contribution.estimate} 分`}` : '考试权重与分数贡献待测评后展示',
      prerequisites: '加载中'
    }
  })
  const nodeById = {}
  nodes.forEach((node) => { nodeById[node.id] = node })
  const prerequisiteNames = {}
  const edges = (payload.dependencies || []).filter((item) => nodeById[String(item.prerequisite_topic_id)] && nodeById[String(item.dependent_topic_id)]).map((item) => {
    const from = nodeById[String(item.prerequisite_topic_id)]
    const to = nodeById[String(item.dependent_topic_id)]
    prerequisiteNames[to.id] = prerequisiteNames[to.id] || []
    prerequisiteNames[to.id].push(from.label)
    return {
      id: String(item.id),
      from: from.id,
      to: to.id,
      strength: String(item.prerequisite_strength || item.strength || 'hard').toLowerCase() === 'soft' ? 'soft' : 'hard',
      style: edgeStyle(from, to)
    }
  })
  nodes.forEach((node) => { node.prerequisites = (prerequisiteNames[node.id] || []).join('、') || '详情可查看跨年级前置知识' })
  const stats = { mastered: 0, learning: 0, weak: 0, unknown: 0 }
  nodes.forEach((node) => { stats[node.status] = (stats[node.status] || 0) + 1 })
  const diagnosticScopes=(payload.diagnostics||[]).filter(s=>s.scope&&s.scope.subject===activeSubjectKey)
  const diagnosticScope=diagnosticScopes.find(s=>s.entry&&s.entry.mode==='resume')||diagnosticScopes.find(s=>s.entry&&s.entry.mode==='continue')||diagnosticScopes.find(s=>s.entry&&s.entry.mode==='report')||diagnosticScopes.find(s=>s.entry&&s.entry.mode==='start')||diagnosticScopes[0]
  const diagnostic=diagnosticScope?{...diagnosticScope.entry,scopeId:diagnosticScope.id,subject:activeSubjectKey,roundCount:diagnosticScope.roundCount||diagnosticScope.entry.roundCount||1,roundMinutes:diagnosticScope.roundMinutes||28}:{mode:'unavailable',subject:activeSubjectKey}

  return {
    diagnostic,
    subjects: subjects.map((item) => ({ key: item.subject_key, name: item.display_name })),
    activeSubject: activeSubject && activeSubject.display_name || '',
    activeSubjectKey,
    // grade = 0：档案选择「都不是」，只展示已有学习证据的知识点，不按年级学期划分
    general: Number(payload.grade) === 0,
    grade: Number(payload.grade) === 0 ? '不限年级' : gradeLabel(payload.grade),
    semester: payload.semester || '',
    unassignedTermCount: topics.filter(topic => !String(topic.semester || '').trim()).length,
    universe: {
      evidenceCount: Number(payload.universe && payload.universe.evidenceCount || 0),
      assessmentEvidenceCount: Number(payload.universe && payload.universe.assessmentEvidenceCount || 0),
      courseEvidenceCount: Number(payload.universe && payload.universe.courseEvidenceCount || 0),
      teacherEvidenceCount: Number(payload.universe && payload.universe.teacherEvidenceCount || 0),
      masteredCount: Number(payload.universe && payload.universe.masteredCount || 0)
    },
    stats,
    nodes,
    edges
  }
}

async function loadKnowledgeMapPayload() {
  let payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP))

  // A newly authenticated WeChat account can reach this page before Zion has
  // created its business-user mapping. Initialize it once and retry the read;
  // never turn this recoverable state into a client-side logout.
  if (payload && payload.status === 'unauthenticated') {
    await loadCurrentUser()
    payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP))
  }
  return payload
}

async function loadKnowledgeMap(subjectKey) {
  return buildKnowledgeMap(await loadKnowledgeMapPayload(), subjectKey)
}

// 「宇宙」Tab：资料卡、学习概览与球面上的知识点。
// 只有进入学习宇宙的知识点才上球：老师核验通过，或测评较稳（含摸底诊断判为掌握）。
// 判定以后端 in_universe 为准；旧版后端没有这个字段时按同一规则从状态推。
const UNIVERSE_CARD_LIMIT = 16
function inUniverse(mastery) {
  if (!mastery) return false
  if (typeof mastery.in_universe === 'boolean') return mastery.in_universe
  const key = graphStatus(mastery).key
  return (key === 'mastered' && mastery.mastery_source !== 'ai_acceptance') || key === 'assessed_stable'
}

function buildKnowledgeUniverse(profile, payload, reportCount) {
  // 地图读失败时只丢掉球面知识点和掌握数，资料卡照常显示。
  const ready = payload && payload.status === 'ready'
  const subjectNameById = {}
  ;(ready && payload.subjects || []).forEach((item) => { subjectNameById[item.id] = item.display_name })
  const masteryByTopic = {}
  ;(ready && payload.masteries || []).forEach((item) => { masteryByTopic[item.knowledge_topic_id] = item })
  const topics = (ready && payload.topics || [])
    .filter((topic) => inUniverse(masteryByTopic[topic.id]))
    .map((topic) => {
      const mastery = masteryByTopic[topic.id]
      return {
        id: String(topic.id),
        name: topic.display_name,
        subject: subjectNameById[topic.subject_id] || '',
        source: mastery.teacher_evidence_count > 0 || mastery.mastery_source === 'teacher_verified' ? 'teacher' : 'assessment',
        evidenceCount: Number(mastery.evidence_count || 0),
        centrality: Number(topic.centrality || 0)
      }
    })
    // 老师核验过的排前面，其次按证据多少、知识点中心度。
    .sort((a, b) => ((a.source === 'teacher' ? 0 : 1) - (b.source === 'teacher' ? 0 : 1)) || (b.evidenceCount - a.evidenceCount) || (b.centrality - a.centrality))
    .map((topic) => ({ ...topic, status: 'mastered', statusText: topic.source === 'teacher' ? '老师核验' : '测评较稳' }))
  const textbook = String(profile.textbook_version || '').replace(/教材$/, '')
  const universe = ready && payload.universe || {}
  return {
    student: {
      name: profileDisplayName(profile),
      avatarText: profileInitial(profile),
      avatarSrc: profile.avatar_url || '',
      subtitle: [profileGradeLabel(profile), textbook].filter(Boolean).join(' · ')
    },
    mapReady: Boolean(ready),
    learningOverview: [
      { id: 'mastered', label: '累计掌握', value: ready ? String(Number(universe.masteredCount || 0)) : '—' },
      { id: 'assessment', label: '测评报告', value: reportCount === null ? '—' : String(reportCount) },
      { id: 'course', label: '课程验收', value: ready ? String(Number(universe.teacherEvidenceCount || 0)) : '—' }
    ],
    cards: topics.slice(0, UNIVERSE_CARD_LIMIT),
    // 进入宇宙的知识点总数（含不在当前学期范围、没上球的）；宇宙页据此提示「还有多少没展示」。
    universeTotal: ready ? Math.max(Number(universe.masteredCount || 0), topics.length) : null,
    recentExplorations: topics.slice(0, 2)
  }
}

async function loadKnowledgeUniverse() {
  const [base, mapResult, reportResult] = await Promise.all([
    loadCurrentStudentDashboardBase(),
    loadKnowledgeMapPayload().then((value) => value, () => null),
    loadCurrentDiagnosticReports().then((value) => value, () => null)
  ])
  return buildKnowledgeUniverse(base.profile, mapResult, reportResult ? reportResult.reports.length : null)
}

// 智能体备课用的学习基本盘：学习档案 + 全学科知识点掌握证据，压成紧凑摘要。
// 两个读取各自容错：图谱失败时仍带上年级学期，由智能体通过摸底补齐。
// 学习基本盘 = 学习宇宙（学习档案 + 知识图谱）+ 学生自己定的学习目标和学习偏好（2026-10-07 用户规则：
// 老师生成课程前必须先看这些）。各读各的，目标、偏好读不到时标 unavailable，不拖累知识点那部分。
// 偏好接口的回包里带着学习目标（goal），一次读两样。
async function loadLearnerBaseline() {
  // 按目标测评的目标导图（2026-10-10）：开场就交给老师 AI，定纲按导图的卡点来；读不到照常摸底
  const [profileResult, mapResult, preferenceResult, goalMapResult] = await Promise.allSettled([
    invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE),
    invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP),
    loadLearningPreference(),
    loadGoalDiagnosis()
  ])
  const profile = profileResult.status === 'fulfilled' ? normalizeProfile(parseActionFlowResult(profileResult.value)) : null
  const knowledgeMap = mapResult.status === 'fulfilled' ? parseActionFlowResult(mapResult.value) : null
  if (!profile && !knowledgeMap) throw (profileResult.reason || mapResult.reason || new Error('学习基本盘读取失败'))
  return Object.assign(summarizeLearnerBaseline(profile, knowledgeMap), {
    learningGoal: summarizeLearningGoal(preferenceResult.status === 'fulfilled' && preferenceResult.value ? preferenceResult.value.goal : null),
    learningPreference: summarizeLearningPreference(preferenceResult.status === 'fulfilled' ? preferenceResult.value : null),
    goalMap: summarizeGoalMap(goalMapResult.status === 'fulfilled' ? goalMapResult.value : null)
  })
}

async function loadKnowledgeTopic(topicId) {
  const payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_K12_TOPIC_DETAIL, { topic_id: normalizeCandidateTopicId(topicId) })) || {}
  const errors = { unauthenticated: '请先登录后查看知识点。', profile_required: '请先完善学习档案。', dataset_unavailable: '知识库正在准备，请稍后重试。' }
  if (payload.status !== 'ready' || !payload.topic) throw new Error(errors[payload.status] || '新知识库中未找到该知识点。')
  if (payload.datasetKey !== 'china-k12-tokenmap-135386badef4') throw new Error('知识点数据源不匹配，请更新后重试。')
  const topic = payload.topic
  const link = (node, reason) => ({ id: String(node.id), label: node.name, gradeLabel: node.grade_label || gradeLabel(node.grade), reason: reason || '' })
  const prerequisiteLinks = (payload.prerequisites || []).map(edge => link(edge.prerequisite, edge.reason))
  const successorLinks = (payload.successors || []).map(edge => link(edge.dependent, edge.reason))
  const relatedLinks = (payload.related || []).map(edge => link(String(edge.source_topic.id) === String(topic.id) ? edge.target_topic : edge.source_topic, edge.reason))
  const evidenceRecords = payload.evidence || []
  return {
    id: String(topic.id), label: topic.name, code: topic.code, description: topic.description || '',
    masteryStandard: topic.mastery_standard || '', grade: topic.grade, gradeLabel: topic.grade_label || gradeLabel(topic.grade),
    subjectKey: topic.subject && topic.subject.code || '', subjectName: topic.subject && topic.subject.name || '',
    volume: topic.volume || '', unit: topic.unit && topic.unit.name || '', status: 'unknown', statusLabel: '待了解',
    evidence: evidenceRecords.length ? `已汇集 ${evidenceRecords.length} 条学习证据` : '尚无测评或老师最终核验证据',
    evidenceRecords, prerequisiteLinks, successorLinks, relatedLinks, prerequisites: prerequisiteLinks.map(p => p.label).join('、') || '来源未列出前置知识'
  }
}

function decimalText(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount.toFixed(2) : '0.00'
}

function roundedCredits(value) {
  const raw = String(value === undefined || value === null ? '0' : value).trim()
  const matched = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?$/)
  if (!matched) return '0'

  const sign = matched[1] === '-' ? '-' : ''
  let integer = matched[2].replace(/^0+(?=\d)/, '')
  const fraction = matched[3] || ''
  if (fraction && fraction.charAt(0) >= '5') {
    const chars = integer.split('')
    let carry = 1
    for (let index = chars.length - 1; index >= 0 && carry; index -= 1) {
      const next = Number(chars[index]) + carry
      chars[index] = String(next % 10)
      carry = next >= 10 ? 1 : 0
    }
    integer = `${carry ? '1' : ''}${chars.join('')}`
  }
  return integer === '0' ? '0' : `${sign}${integer}`
}

async function loadCreditProducts() {
  const payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CREDIT_PRODUCTS)) || {}
  const buyerIsMember = payload.buyerIsMember === true
  return {
    buyerIsMember,
    products: (payload.products || []).map((item) => ({
      id: item.id,
      productCode: item.credit_product && item.credit_product.product_code,
      name: item.display_name,
      description: item.description,
      amount: decimalText(item.amount),
      // Display only: the order flow re-checks the beneficiary and charges the authoritative amount.
      memberAmount: item.member_amount ? decimalText(item.member_amount) : '',
      payableAmount: buyerIsMember && item.member_amount ? decimalText(item.member_amount) : decimalText(item.amount),
      memberPriceApplied: buyerIsMember && !!item.member_amount,
      credits: roundedCredits(item.credit_amount),
      estimatedCourseCount: Number(item.estimated_course_count || 0),
      validityRule: item.validity_rule || {},
      serviceRule: item.service_rule || {},
      refundRule: item.refund_rule || {},
      subjectScope: item.subject_scope || []
    }))
  }
}

async function loadCreditProduct(productVersionId) {
  const productId = String(productVersionId || '')
  if (!productId) throw new Error('商品版本无效，请返回商城重新选择。')

  const { products } = await loadCreditProducts()
  const product = products.find((item) => String(item.id) === productId)
  if (!product) throw new Error('该商品已下架或版本已更新，请返回商城重新选择。')
  return product
}

function createIdempotencyKey() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `credit-order-${timestamp}-${random}`
}

function createAssignmentRequestKey() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `promoter-assignment-${timestamp}-${random}`
}

function createRedemptionKey() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `redemption-${timestamp}-${random}`
}

function createPromotionKey(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`
}

function validInternalPath(value) {
  const path = String(value || '').trim()
  return /^\/pages\/[A-Za-z0-9_/-]+(?:\?[A-Za-z0-9_=&%-]+)?$/.test(path) ? path : ''
}

function validPromotionToken(value) {
  const token = String(value || '').trim()
  return /^[A-Za-z0-9_-]{16,512}$/.test(token) ? token : ''
}

function validPosterTheme(value) {
  const theme = String(value || '').trim().replace(/\s+/g, ' ')
  if (theme.length < 4 || theme.length > 160) {
    throw new Error('请填写 4 到 160 个字的海报主题。')
  }
  return theme
}

async function generateCurrentPromoterPosterBackground(theme, onStatus) {
  const normalizedTheme = validPosterTheme(theme)
  const zai = config.ZAI && config.ZAI.PROMOTION_POSTER_BACKGROUND
  if (!zai || !zai.id || !zai.inputKey) throw new Error('海报生成服务尚未配置。')

  const currentCenter = await loadCurrentGrowthCenter()
  if (!currentCenter.promoter || currentCenter.promoter.status !== 'active') {
    throw new Error('当前账户不是有效推广伙伴。')
  }

  const created = await graphql(
    `mutation CreatePromotionPosterConversation($zaiConfigId: String!, $inputArgs: Map_String_ObjectScalar!) {
      conversationId: fz_zai_create_conversation(zaiConfigId: $zaiConfigId, inputArgs: $inputArgs)
    }`,
    { zaiConfigId: zai.id, inputArgs: { [zai.inputKey]: normalizedTheme } }
  )
  const conversationId = Number(created && created.conversationId)
  if (!Number.isSafeInteger(conversationId) || conversationId <= 0) {
    throw new Error('海报任务创建失败，请稍后重试。')
  }

  for (let attempt = 0; attempt < 36; attempt += 1) {
    const result = await graphql(
      `query GetPromotionPosterConversation($conversationId: Long!) {
        result: fz_zai_conversation_result(conversationId: $conversationId) {
          conversationId
          status
          images { id url }
        }
      }`,
      { conversationId }
    )
    const task = result && result.result
    const status = String(task && task.status || '')
    if (typeof onStatus === 'function') onStatus(status || 'IN_PROGRESS')
    if (status === 'COMPLETED') {
      const image = Array.isArray(task.images) ? task.images.find((item) => item && item.id && item.url) : null
      if (!image) throw new Error('海报图片未返回，请重新生成。')
      return { conversationId: String(conversationId), imageId: String(image.id), imageUrl: String(image.url) }
    }
    if (['FAILED', 'STOPPED', 'CANCELLED'].includes(status)) {
      throw new Error('海报生成未完成，请稍后重试。')
    }
    await wait(2500)
  }
  throw new Error('海报生成时间较长，请稍后重新进入查看。')
}

// ---- 邀请码中心（AF46，2026-09-22）----
// 对外一律叫「邀请码」（2026-09-22 用户定名）；Zion 侧的动作流、表字段与本文件的标识符
// 仍是 promotion_code / PROMOTION_CODE_*，改名只改给用户看的文案，不动后端契约。
// 人人都有邀请码：首次调用时后端惰性建一条推广档案（状态 inactive）。
// 小程序码由后端签发（扫码进首页，场景值带 pc=<邀请码>），前端不生成、不伪造。
const PROMOTION_CODE_MESSAGES = {
  unauthenticated: '请先登录后再使用邀请码。',
  profile_incomplete: '请先完善学习档案后再绑定邀请码。',
  invalid_code: '请填写邀请码。',
  code_not_found: '邀请码不存在，请核对后重试。',
  self_code: '不能填写自己的邀请码。',
  invalid_asset: '海报不存在或已下架。',
  poster_unavailable: '该海报暂时不能生成推广图。',
  qrcode_unavailable: '小程序码生成失败，请稍后重试。',
  promotion_code_unavailable: '邀请码分配失败，请稍后重试。',
  bind_failed: '绑定失败，请稍后重试。'
}

// 确定性失败（再试一次结果也一样）：调用方据此丢掉待绑定线索，不让它在后续启动里反复冒出来。
// profile_incomplete 不在其中——建档之后还能绑上。
const TERMINAL_PROMOTION_CODE_STATUSES = ['invalid_code', 'code_not_found', 'self_code']

function promotionCodeError(status) {
  const error = new Error(PROMOTION_CODE_MESSAGES[status] || '邀请码服务暂时不可用，请稍后重试。')
  error.promotionStatus = status
  if (TERMINAL_PROMOTION_CODE_STATUSES.includes(status)) error.terminalReferral = true
  return error
}

async function invokePromotionCodeCenter(payload) {
  const result = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.PROMOTION_CODE_CENTER, { payload }, { timeout: 20000 }
  )) || {}
  const status = String(result.status || '')
  if (status === 'ready' || status === 'already_attributed') return result
  throw promotionCodeError(status)
}

function normalizePromoterView(promoter) {
  if (!promoter) return null
  return {
    id: String(promoter.id || ''),
    name: String(promoter.display_name || '') || '知鹿用户',
    promotionCode: String(promoter.promotion_code || ''),
    // 状态 active 表示已开通推广伙伴（可提现），普通用户是 inactive 但照样能拉人
    partnerActive: String(promoter.status || '') === 'active',
    qrUrl: String(promoter.qr_url || '')
  }
}

/** 我的邀请码与小程序码。 */
async function loadCurrentPromotionCode() {
  const result = await invokePromotionCodeCenter({ operation: 'code' })
  return normalizePromoterView(result.promoter)
}

/**
 * 取海报原图与我的透明底小程序码（合成在小程序端做）。
 * 两个地址都是后端签发的签名链接，约两天过期，拿到就用、别存起来。
 */
async function loadCurrentPromotionPosterParts(assetId) {
  const id = Number(assetId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('海报不存在或已下架。')
  const result = await invokePromotionCodeCenter({ operation: 'poster', asset_id: id })
  const posterUrl = String(result.poster_url || '')
  const qrUrl = String(result.qr_url || '')
  if (!posterUrl || !qrUrl) throw new Error('推广图生成失败，请稍后重试。')
  return { posterUrl, qrUrl, promotionCode: String(result.promotion_code || '') }
}

/**
 * 按邀请码绑定推荐人；已有推荐人时返回 alreadyBound，不覆盖。
 * rewardCredits 是「填邀请码送积分」活动这次到账的积分：活动关着、已经领过或额度发完都是 0。
 */
async function bindCurrentPromotionCode(promotionCode) {
  const code = String(promotionCode || '').trim().toUpperCase()
  if (!code) throw promotionCodeError('invalid_code')
  const result = await invokePromotionCodeCenter({ operation: 'bind', promotion_code: code })
  const rewardCredits = Number(result.reward_credits)
  return {
    alreadyBound: result.status === 'already_attributed',
    referrer: normalizePromoterView(result.referrer),
    rewardCredits: Number.isFinite(rewardCredits) && rewardCredits > 0 ? rewardCredits : 0
  }
}

/** 我的推荐人（谁把我带进来的）及其二维码；没有返回 null。 */
async function loadCurrentReferrer() {
  const result = await invokePromotionCodeCenter({ operation: 'referrer' })
  return {
    referrer: normalizePromoterView(result.referrer),
    attributedAt: String(result.attributed_at || '')
  }
}

async function loadPublishedPromotionAssets() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_PUBLISHED_PROMOTION_ASSETS
  )) || {}

  if (payload.status === 'unauthenticated') throw new Error('请先登录后查看宣传素材。')
  if (payload.status === 'promoter_inactive') return { status: 'promoter_inactive', assets: [] }
  if (payload.status !== 'ready') throw new Error('宣传素材暂时无法读取，请稍后重试。')

  return {
    status: 'ready',
    assets: (payload.assets || []).filter((item) => item && item.id && item.title).map((item) => ({
      id: String(item.id),
      assetNo: String(item.asset_no || ''),
      assetType: String(item.asset_type || ''),
      versionNo: String(item.version_no || ''),
      title: String(item.title),
      campaignKey: String(item.campaign_key || ''),
      copyText: String(item.copy_text || ''),
      publishedAt: item.published_at || '',
      expiresAt: item.expires_at || '',
      coverImage: item.cover_image && item.cover_image.url ? {
        id: String(item.cover_image.id || ''), url: String(item.cover_image.url)
      } : null,
      assetFile: item.asset_file && item.asset_file.url ? {
        id: String(item.asset_file.id || ''), url: String(item.asset_file.url)
      } : null
    }))
  }
}

// 每日学习打卡：返回北京时间的今天与打卡日期（当天有效课程学习累计满门槛秒数算一天）。
async function loadCurrentLearningCheckin() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_LEARNING_CHECKIN, {}, { timeout: 10000 }
  )) || {}
  if (payload.status === 'unauthenticated') throw new Error('请先登录后查看学习打卡。')
  if (payload.status === 'not_initialized') throw createProfileRequiredError('请先完善学习资料后查看学习打卡。')
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/
  if (payload.status !== 'ready' || !dayPattern.test(String(payload.today || ''))) {
    throw new Error('学习打卡暂时无法读取，请稍后重试。')
  }
  const days = (value) => (Array.isArray(value) ? value : []).map(String).filter((day) => dayPattern.test(day))
  const today = payload.todayCheckin && typeof payload.todayCheckin === 'object' ? payload.todayCheckin : null
  const reward = payload.reward && typeof payload.reward === 'object' ? payload.reward : {}
  const revivable = payload.revivable && typeof payload.revivable === 'object' ? payload.revivable : null
  return {
    today: String(payload.today),
    checkedDates: days(payload.checkedDates),
    // 冻结日（可以在未来）、复活补上的日子：受保护，接得上连胜但不计天数。
    frozenDates: days(payload.frozenDates),
    revivedDates: days(payload.revivedDates),
    todayCheckin: today ? {
      source: String(today.source || ''),
      title: String(today.title || ''),
      rewardCoins: Math.max(0, wholeNumber(today.rewardCoins))
    } : null,
    // 打卡金币按连续天数递增（2026-09-27）：nextCoins 是下一次打卡能拿多少，nextDay 说是今天还是明天。
    reward: {
      enabled: reward.enabled === true,
      coins: Math.max(0, wholeNumber(reward.coins)),
      nextDay: reward.nextDay === 'tomorrow' ? 'tomorrow' : 'today',
      nextCoins: Math.max(0, wholeNumber(reward.nextCoins))
    },
    coinsEarned: Math.max(0, wholeNumber(payload.coinsEarned)),
    cards: (Array.isArray(payload.cards) ? payload.cards : [])
      .filter((card) => card && ['freeze', 'revive'].includes(card.type))
      .map((card) => ({
        type: card.type,
        title: String(card.title || ''),
        description: String(card.description || ''),
        count: Math.max(0, wholeNumber(card.count)),
        effectDays: Math.max(0, wholeNumber(card.effectDays)),
        windowDays: Math.max(0, wholeNumber(card.windowDays)),
        enabled: card.enabled === true
      })),
    cardRules: (Array.isArray(payload.cardRules) ? payload.cardRules : [])
      .filter((rule) => rule && ['freeze', 'revive'].includes(rule.cardType))
      .map((rule) => ({
        cardType: rule.cardType,
        trigger: rule.trigger === 'total_days' ? 'total_days' : 'streak_days',
        days: Math.max(0, wholeNumber(rule.days)),
        repeat: rule.repeat === 'every' ? 'every' : 'once',
        count: Math.max(0, wholeNumber(rule.count))
      }))
      .filter((rule) => rule.days > 0 && rule.count > 0),
    freezePlan: Array.isArray(payload.freezePlan) ? days(payload.freezePlan) : null,
    revivable: revivable && Array.isArray(revivable.dates) ? { dates: days(revivable.dates) } : null
  }
}

// 使用学习连胜道具卡（AF48）：freeze 冻结接下来几天，revive 补回最近断掉的几天。
// 同一次点击重试时复用同一个幂等键，不会扣两张卡。
async function useCurrentStreakCard(cardType, idempotencyKey) {
  if (!['freeze', 'revive'].includes(cardType)) throw new Error('道具卡无效，请刷新后重试。')
  // 流程编号由 scripts/learning-streak/deploy-learning-streak-zion.mjs 上线后写进 config；还没写进来就是还没开放。
  if (!/^[0-9a-f-]{36}$/i.test(String(config.ACTION_FLOWS.USE_CURRENT_STREAK_CARD.id || ''))) throw new Error('道具卡暂未开放，请稍后再试。')
  const key = String(idempotencyKey || createStreakCardKey())
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.USE_CURRENT_STREAK_CARD,
    { payload: { operation: 'use', card_type: cardType, idempotency_key: key } },
    { timeout: 15000 }
  )) || {}
  const messages = {
    unauthenticated: '请先登录后再使用道具卡。',
    not_initialized: '请先完善学习档案。',
    no_card: cardType === 'freeze' ? '冻结卡用完了。' : '复活卡用完了。',
    card_disabled: '这种道具卡暂未开放。',
    no_streak: '现在还没有连胜，不需要冻结。',
    nothing_to_revive: '连胜没有断，暂时不需要复活卡。',
    invalid: '请求无效，请刷新后重试。'
  }
  if (payload.status !== 'used') throw new Error(messages[payload.status] || '道具卡暂时无法使用，请稍后重试。')
  return {
    cardType: payload.card_type,
    dates: (Array.isArray(payload.dates) ? payload.dates : []).map(String),
    remaining: Math.max(0, wholeNumber(payload.remaining)),
    streakDays: Math.max(0, wholeNumber(payload.streak_days)),
    replayed: payload.replayed === true
  }
}

function createStreakCardKey() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `streak-card-${timestamp}-${random}`
}

async function claimCurrentDailyCoinCheckin() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CLAIM_CURRENT_DAILY_COIN_CHECKIN
  )) || {}
  const messages = {
    unauthenticated: '请先登录后签到。',
    not_initialized: '请先完善学习档案后签到。',
    rule_unavailable: '今日签到奖励暂未发布。'
  }
  if (!['checked_in', 'already_checked_in'].includes(payload.status)) {
    throw new Error(messages[payload.status] || '签到暂时无法完成，请稍后重试。')
  }
  return {
    status: payload.status,
    checkinDate: String(payload.checkin_date || ''),
    rewardCoins: wholeNumber(payload.reward_coins),
    availableCoins: wholeNumber(payload.available_coins)
  }
}

async function createCurrentPromoterInvitation({ targetPath, sceneType = 'share', idempotencyKey } = {}) {
  const targetPathValue = validInternalPath(targetPath)
  const scene = String(sceneType || '').trim()
  if (!targetPathValue) throw new Error('推广落地页无效，请刷新后重试。')
  if (!['share', 'poster', 'material'].includes(scene)) {
    throw new Error('推广场景无效，请刷新后重试。')
  }

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CREATE_CURRENT_PROMOTER_INVITATION,
    {
      target_path: targetPathValue,
      scene_type: scene,
      idempotency_key: String(idempotencyKey || createPromotionKey('promotion_invitation'))
    }
  )) || {}
  const invitation = payload.invitation || {}
  const share = payload.share || {}
  const token = validPromotionToken(share.token)
  const path = String(share.path || '').trim()
  const messages = {
    promoter_inactive: '当前推广伙伴资格不可用。',
    profile_incomplete: '请先完善学习档案后再创建邀请。',
    invalid_request: '邀请信息不完整，请刷新后重试。'
  }
  if (!token || !/^\/pages\/referral-entry\/index\?token=[A-Za-z0-9_-]{16,512}$/.test(path)) {
    throw new Error(messages[payload.status] || '邀请创建失败，请稍后重试。')
  }
  return {
    reused: Boolean(payload.reused),
    invitation: {
      id: invitation.id || null,
      code: String(invitation.invitation_code || ''),
      expiresAt: invitation.expires_at || '',
      status: invitation.status || ''
    },
    sharePath: path
  }
}

async function recordCurrentPromotionTouchAndAttribute({ invitationToken, sourceType = 'share', idempotencyKey } = {}) {
  const token = validPromotionToken(invitationToken)
  const source = String(sourceType || '').trim()
  if (!token) throw new Error('邀请链接无效或已失效。')
  if (!['share', 'poster', 'material', 'code'].includes(source)) {
    throw new Error('邀请来源无效，请重新进入。')
  }

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE,
    {
      invitation_token: token,
      source_type: source,
      idempotency_key: String(idempotencyKey || createPromotionKey('promotion_touch'))
    }
  )) || {}
  const messages = {
    invitation_invalid: '邀请链接无效或已失效。',
    invitation_expired: '邀请链接已过期，请联系推广伙伴重新分享。',
    deep_gift_consumed: '深测资格已被领取，请联系推广伙伴重新获取邀请。',
    self_invitation: '不能领取自己的推广邀请。',
    profile_incomplete: '请先完善学习档案后再领取邀请。',
    already_attributed: '你已绑定其他推广伙伴，归因不会变更。'
  }
  if (['invitation_invalid', 'invitation_expired', 'deep_gift_consumed', 'self_invitation'].includes(payload.status)) {
    const error = new Error(messages[payload.status])
    error.terminalReferral = true
    throw error
  }
  if (payload.status === 'profile_incomplete') throw new Error(messages[payload.status])
  if (payload.status === 'already_attributed') {
    return { reused: true, attribution: payload.attribution || null, touch: payload.touch || null }
  }
  if (!payload.touch && !payload.attribution && !payload.reused && !['recorded', 'attributed'].includes(payload.status)) {
    throw new Error('邀请领取失败，请稍后重试。')
  }
  return {
    reused: Boolean(payload.reused),
    isDeepGift: payload.deep_gift === true || payload.status === 'deep_gift_granted' || payload.status === 'deep_gift_consumed',
    grant: payload.grant || null,
    attribution: payload.attribution || null,
    touch: payload.touch || null
  }
}

async function loadPromoterAssignmentRequest() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_PROMOTER_ASSIGNMENT_REQUEST
  )) || {}
  return {
    studentId: payload.studentId || null,
    request: payload.request || null,
    attribution: payload.attribution ? {
      ...payload.attribution,
      promoter: payload.attribution.promoter_profile || null
    } : null
  }
}

async function loadCurrentFamilyRelations() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_FAMILY_RELATIONS
  )) || {}
  const self = payload.self || null
  return {
    self,
    students: (payload.students || []).map((relation) => ({
      ...relation,
      student: relation.student_profile || null,
      avatarUrl: profileAvatarUrl(relation.student_profile)
    })),
    guardians: payload.guardians || []
  }
}

async function createCurrentStudentBindingCode() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CREATE_CURRENT_STUDENT_BINDING_CODE
  )) || {}

  const messages = {
    unauthenticated: '请先登录后生成绑定码。',
    not_initialized: '当前账号尚未完成初始化，请重新登录后重试。',
    profile_incomplete: '请先完善学生学习档案。',
    student_profile_required: '仅学生本人可以生成绑定码。',
    rate_limited: '操作过于频繁，请稍后重试。'
  }

  if (messages[payload.status]) throw new Error(messages[payload.status])
  if (payload.status !== 'ready' || !payload.code || !payload.expiresAt) {
    throw new Error('绑定码生成失败，请稍后重试。')
  }

  return {
    code: String(payload.code),
    expiresAt: payload.expiresAt,
    bindingCodeId: payload.bindingCodeId || null
  }
}

async function bindCurrentGuardianToStudent(code) {
  const normalizedCode = String(code || '').replace(/\s/g, '')
  if (!/^\d{8}$/.test(normalizedCode)) {
    throw new Error('请输入 8 位数字绑定码。')
  }

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.BIND_CURRENT_GUARDIAN_TO_STUDENT,
    { code: normalizedCode }
  )) || {}

  const messages = {
    unauthenticated: '请先登录后绑定学生。',
    not_initialized: '当前账号尚未完成初始化，请重新登录后重试。',
    guardian_verification_required: '请先完成家长实名认证。',
    guardian_underage: `实名认证显示未满 ${payload.minAge || 22} 周岁，暂不能作为家长绑定学生。`,
    guardian_age_unknown: '实名信息里没有出生日期，请重新提交一次实名认证。',
    invalid_code: '绑定码无效，请向学生重新获取。',
    expired: '绑定码已过期，请向学生重新获取。',
    already_used: '绑定码已被使用，请向学生重新获取。',
    self_binding_forbidden: '不能绑定自己的学生档案。',
    already_bound: '该学生已经在你的家庭关系中。',
    relation_inactive: '该家庭关系当前不可用，请联系客服处理。',
    // 服务商（2026-10-11）：绑定码绑的 + 建的网页端孩子合计到了后台设的上限
    provider_limit_reached: `已绑定 ${payload.used || payload.limit || 0} 个孩子，达到上限 ${payload.limit || 0} 个，需要更多名额请联系知鹿调整。`
  }

  if (payload.status !== 'bound') {
    // 带上状态码：绑定页据 guardian_verification_required 切回「先完成实名认证」
    const error = new Error(messages[payload.status] || '绑定学生失败，请稍后重试。')
    error.status = payload.status
    throw error
  }

  return payload.relation || null
}

async function loadCurrentIdentityVerification() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_IDENTITY_VERIFICATION, {}, { timeout: 10000 }
  )) || {}

  if (payload.status === 'unauthenticated') throw new Error('请先登录后查看实名认证状态。')
  if (payload.status === 'not_initialized') throw new Error('当前账号尚未完成初始化，请重新登录后重试。')
  if (payload.status !== 'ready') throw new Error('实名认证状态暂时无法读取。')

  return {
    verification: payload.verification || null,
    roles: payload.roles || []
  }
}

async function submitCurrentGuardianIdentityVerification(form = {}) {
  const name = String(form.name || '').trim()
  const idCardNumber = String(form.idCardNumber || '').replace(/\s/g, '').toUpperCase()

  if (!name || name.length > 50) throw new Error('请输入有效姓名。')
  if (!/^\d{17}[0-9X]$/.test(idCardNumber)) throw new Error('请输入有效的 18 位身份证号。')

  const sessionToken = await getRuntimeToken()
  if (identityVerificationFlight && identityVerificationFlight.token === sessionToken) {
    throw new Error('实名认证正在处理中，请稍后刷新状态。')
  }
  const flight = { token: sessionToken }
  identityVerificationFlight = flight
  let payload
  try {
    payload = parseActionFlowResult(await invokeActionFlow(
      config.ACTION_FLOWS.SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION,
      { name, idCardNumber },
      { timeout: 15000, expectedToken: sessionToken }
    )) || {}
  } finally {
    if (identityVerificationFlight === flight) identityVerificationFlight = null
  }

  if (!payload.success) {
    const error = new Error(payload.message || '实名认证未通过，请核对信息后重试。')
    // identity_mismatch：已实名的账号填了另一个人的姓名或身份证号（推广伙伴申请页据此提示填实名那张证）
    if (payload.verify === 'identity_mismatch') error.code = 'IDENTITY_MISMATCH'
    throw error
  }

  return {
    recordId: payload.recordId == null ? null : String(payload.recordId),
    duplicate: !!payload.duplicate,
    message: payload.message || '实名认证成功。',
    maskedIdCard: payload.maskedIdCard || '',
    province: payload.province || '',
    city: payload.city || '',
    sex: payload.sex || '',
    birthday: payload.birthday || ''
  }
}

// 学生看板（2026-10-11 起）：后端先列名下全部孩子（称呼、年级、头像），只读 studentProfileId 那一个孩子的完整数据
// （不传或不在名下就是第一个）；返回里只有那个孩子 detailLoaded = true。服务商名下孩子多，一次全读会超时。
async function loadGuardianDashboard(studentProfileId) {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_DASHBOARD,
    { payload: studentProfileId ? { studentProfileId: String(studentProfileId) } : {} }
  )) || {}

  return {
    status: payload.status || 'no-active-children',
    selectedStudentProfileId: payload.selected_student_profile_id == null ? null : String(payload.selected_student_profile_id),
    children: (payload.children || []).map((relation) => {
      const profile = relation.student_profile || {}
      return {
        relationId: relation.id,
        detailLoaded: relation.detail_loaded === true,
        relationshipType: relation.relationship_type || 'guardian',
        effectiveAt: relation.effective_at || null,
        expiresAt: relation.expires_at || null,
        profile,
        avatarUrl: profileAvatarUrl(profile),
        report: (profile.diagnostic_reports || [])[0] || null,
        prediction: (profile.score_predictions || [])[0] || null,
        plan: (profile.learning_plans || [])[0] || null,
        creditAccount: profile.credit_account || null
      }
    })
  }
}

async function loadCurrentLoginIdentities() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_LOGIN_IDENTITIES
  )) || {}
  return payload.principal || null
}

async function loadGuardianLearningFeed() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_LEARNING_FEED
  )) || {}
  return {
    status: payload.status || 'no-active-children',
    children: (payload.children || []).map((relation) => ({
      relationId: relation.id,
      profile: relation.student_profile || {},
      avatarUrl: profileAvatarUrl(relation.student_profile),
      state: relation.student_profile && relation.student_profile.current_learning_state || null,
      rollups: relation.student_profile && relation.student_profile.learning_time_rollups || []
    }))
  }
}

async function loadAuthorizedTopicLearningReports() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_AUTHORIZED_TOPIC_LEARNING_REPORTS
  )) || {}

  const toStudent = (profile, source) => ({
    id: profile && profile.id,
    profile: profile || {},
    source,
    reports: (profile && profile.topic_learning_reports || []).map((report) => ({
      ...report,
      audioAssets: report.feynman_acceptance && report.feynman_acceptance.audio_assets || []
    }))
  })

  const students = []
  if (payload.own) students.push(toStudent(payload.own, 'self'))
  ;(payload.children || []).forEach((relation) => {
    if (relation.student_profile) students.push(toStudent(relation.student_profile, 'guardian'))
  })

  return { students }
}

async function authorizeAcceptanceAudio(audioAssetId) {
  const id = Number(audioAssetId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('音频标识无效，请刷新报告后重试。')

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.AUTHORIZE_ACCEPTANCE_AUDIO,
    { audio_asset_id: id }
  )) || {}

  if (!payload.authorized || !payload.asset || !payload.asset.url) {
    const reasons = {
      account_uninitialized: '当前账号尚未完成初始化，请重新登录后再试。',
      retention_expired: '该原声已超过保存期限，暂时不可播放。',
      invalid_request: '音频请求无效，请刷新报告后重试。',
      not_authorized: '当前身份无权播放这段原声。'
    }
    throw new Error(reasons[payload.reason] || '原声暂时不可播放。')
  }

  return payload.asset
}

async function loadCurrentNotifications() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_NOTIFICATIONS
  )) || {}
  if (payload.status === 'unauthenticated') throw new Error('请先登录后查看消息。')
  if (payload.status === 'account_uninitialized') throw new Error('当前账号尚未完成初始化，请重新登录后再试。')
  return payload.notifications || []
}

async function markCurrentNotificationRead(notificationId) {
  const id = Number(notificationId)
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('通知标识无效。')
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.MARK_CURRENT_NOTIFICATION_READ,
    { notification_id: id }
  )) || {}
  if (payload.status !== 'ready') throw new Error('通知状态更新失败，请稍后重试。')
  return Boolean(payload.updated)
}

async function submitPromoterAssignmentRequest(form = {}) {
  const contact = String(form.contact || '').trim()
  const idempotencyKey = String(form.idempotencyKey || createAssignmentRequestKey())
  if (contact.length < 3) throw new Error('请填写有效的联系方式。')

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.SUBMIT_PROMOTER_ASSIGNMENT_REQUEST,
    {
      contact,
      region: String(form.region || '').trim(),
      available_time: String(form.availableTime || '').trim(),
      idempotency_key: idempotencyKey
    }
  )) || {}
  if (!payload.request) throw new Error('申请提交未返回状态，请稍后刷新确认。')
  return payload
}

async function cancelPromoterAssignmentRequest(idempotencyKey) {
  const key = String(idempotencyKey || '').trim()
  if (!key) throw new Error('当前申请缺少撤回标识，请刷新后重试。')
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CANCEL_CURRENT_PROMOTER_ASSIGNMENT_REQUEST,
    { idempotency_key: key }
  )) || {}
  if (!payload.request) throw new Error('撤回未返回申请状态，请稍后刷新确认。')
  return payload
}

async function createSecureCreditOrder(productVersionId, beneficiaryStudentId, idempotencyKey) {
  const productVersion = Number(productVersionId)
  const beneficiary = Number(beneficiaryStudentId)
  if (!Number.isSafeInteger(productVersion) || productVersion <= 0) throw new Error('商品版本无效，请返回商城重新选择。')
  if (!Number.isSafeInteger(beneficiary) || beneficiary <= 0) throw new Error('受益学生无效，请重新进入确认订单。')

  let payload
  try {
    payload = parseActionFlowResult(await invokeActionFlow(
      config.ACTION_FLOWS.CREATE_SECURE_CREDIT_ORDER,
      {
        product_version_id: productVersion,
        beneficiary_student_id: beneficiary,
        idempotency_key: idempotencyKey || createIdempotencyKey()
      }
    )) || {}
  } catch (error) {
    // 后端：支付开关关着（管理端「活动开关 → 会员与积分包支付」）不能下单
    if (/PAYMENT_DISABLED/.test(String(error && error.message || ''))) {
      throw Object.assign(new Error(paymentClosedMessage('credits')), { code: 'PAYMENT_DISABLED' })
    }
    // 后端：没有推荐人归因不能下单（「该学生尚未建立有效推广归因」）
    if (/推广归因/.test(String(error && error.message || ''))) {
      const wrapped = new Error('请先填写邀请码（有推荐人）后再购买积分包。')
      wrapped.code = 'CREDIT_INVITE_REQUIRED'
      throw wrapped
    }
    throw error
  }

  if (!payload.order_id && !payload.orderId) throw new Error('订单创建未返回订单编号，请稍后在订单记录中确认。')
  return {
    orderId: payload.order_id || payload.orderId,
    orderNo: payload.order_no || payload.orderNo || '',
    amount: decimalText(payload.amount || payload.authoritative_amount),
    description: payload.description || payload.title || '',
    expiresAt: payload.expires_at || payload.expiresAt || ''
  }
}

async function redeemCurrentStudentCode(code, beneficiaryStudentId, idempotencyKey) {
  const normalizedCode = String(code || '').trim().toUpperCase()
  const beneficiary = Number(beneficiaryStudentId)
  if (!/^[A-Z0-9-]{6,128}$/.test(normalizedCode)) throw new Error('请输入有效的兑换码。')
  if (!Number.isSafeInteger(beneficiary) || beneficiary <= 0) throw new Error('受益学生无效，请返回后重新进入。')

  let payload
  try {
    payload = parseActionFlowResult(await invokeActionFlow(
      config.ACTION_FLOWS.REDEEM_CURRENT_STUDENT_CODE,
      {
        code: normalizedCode,
        beneficiary_student_id: beneficiary,
        idempotency_key: idempotencyKey || createRedemptionKey()
      }
    )) || {}
  } catch (error) {
    const message = String(error && error.message || '')
    if (/REDEMPTION_(?:CODE_INVALID|INPUT_INVALID|CODE_FORMAT_INVALID|STUDENT_INVALID|IDEMPOTENCY_KEY_INVALID|SESSION_INVALID|IDENTITY_INVALID|CODE_UNAVAILABLE|SCOPE_INVALID|BENEFIT_INVALID|PRODUCT_INVALID)/.test(message)) {
      throw new Error('兑换码无效、已过期或暂不适用于当前学生。')
    }
    if (message.includes('REDEMPTION_ACCOUNT_NOT_READY')) throw new Error('当前学生的权益账户尚未准备完成，请稍后重试。')
    if (message.includes('IDEMPOTENCY_CONFLICT')) throw new Error('本次兑换请求已变化，请勿重复提交。')
    throw error
  }

  if (!payload.ok) {
    if (payload.status === 'succeeded') return payload
    throw new Error('兑换未完成，请稍后在兑换记录中确认。')
  }
  return payload
}

function ledgerProfileName(profile, fallback) {
  return profile && (profile.nickname || profile.real_name) || fallback
}

// Who a ledger row was spent on, seen from the account being viewed. Empty when owner and beneficiary
// are the same person (the ordinary case); otherwise names the child (guardian view) or the guardian
// whose credits paid (child view).
function ledgerCounterpartyLabel(item, targetId) {
  const ownerId = item.learner_profile_id != null ? String(item.learner_profile_id) : targetId
  const beneficiaryId = item.beneficiary_profile_id != null ? String(item.beneficiary_profile_id) : ownerId
  if (beneficiaryId === ownerId) return ''
  if (ownerId === targetId) return `使用人：${ledgerProfileName(item.beneficiary_profile, '孩子')}`
  return `使用${ledgerProfileName(item.learner_profile, '家长')}的积分`
}

// 定制课程扣费（agent_course）与补扣欠款（agent_course_debt_repay）流水的说明：课程名；当时余额不够的，
// 写清这节课多少积分、还欠多少（或已补扣）。流水的 business_ref 是课程编号，对应积分账户返回的 agentCourseCharges。
function agentCourseLedgerDetail(item, charges) {
  const type = item.business_type
  if (type !== 'agent_course' && type !== 'agent_course_debt_repay') return ''
  const charge = charges[item.business_ref]
  const title = charge && charge.title ? `《${charge.title}》` : ''
  if (type === 'agent_course_debt_repay') return title ? `${title}的欠款` : ''
  if (!charge) return ''
  const debt = Number(charge.debt_credits) || 0
  if (!(debt > 0)) return title
  const owed = Math.max(0, debt - (Number(charge.repaid_credits) || 0))
  const state = owed > 0 ? `${roundedCredits(owed)} 待补扣` : '欠款已补扣'
  return `${title}${title ? ' · ' : ''}本节 ${roundedCredits(charge.actual_credits)}，${state}`
}

// studentId is optional: a bound guardian passes a child's profile id to read that child's account.
async function loadCurrentCreditAccount(studentId) {
  const args = studentId ? { studentId: String(studentId) } : {}
  let payload
  try {
    payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT, args)) || {}
  } catch (error) {
    const message = String(error && error.message || '')
    if (/polyglotexception|syntaxerror|missing close quote/i.test(message)) {
      throw new Error('课程积分服务配置异常，请联系管理员处理。')
    }
    if (message.includes('STUDENT_NOT_AUTHORIZED')) throw new Error('没有查看该学生课程积分的权限。')
    throw error
  }
  const account = payload.account || {}
  const targetId = payload.studentId != null ? String(payload.studentId) : ''
  // 每节定制课程扣过一次（status charged）；同一节课没扣成的那几次（released）不显示在流水里
  const agentCharges = {}
  ;(payload.agentCourseCharges || []).forEach((row) => {
    if (row && row.stage_id && row.status === 'charged') agentCharges[row.stage_id] = row
  })
  const viewerId = payload.viewerStudentId != null ? String(payload.viewerStudentId) : targetId
  return {
    studentId: payload.studentId || null,
    viewer: { studentId: viewerId || null, isSelf: !targetId || viewerId === targetId },
    student: payload.student ? { id: String(payload.student.id), name: ledgerProfileName(payload.student, '') } : null,
    // 2026-11-11 全家共用：家长的会员为这个孩子出积分时，下面的余额、批次、流水是家长名下的家庭账户
    family: payload.family ? { profileId: String(payload.family.profileId), name: ledgerProfileName(payload.family.profile || {}, '家长') } : null,
    account: {
      status: account.status || 'inactive',
      available: roundedCredits(account.available_credits),
      frozen: roundedCredits(account.frozen_credits),
      consumed: roundedCredits(account.consumed_credits),
      expired: roundedCredits(account.expired_credits)
    },
    batches: (payload.batches || []).map((item) => ({
      ...item,
      remainingCreditsDisplay: roundedCredits(item.remaining_credits),
      sourceLabel: display.sourceLabel(item.source_type),
      activeAtLabel: display.dateTimeLabel(item.active_at || item.created_at)
    })),
    ledger: (payload.ledger || []).map((item) => ({
      ...item,
      creditsDisplay: roundedCredits(item.credits),
      businessLabel: display.businessLabel(item.business_type, item.entry_type),
      occurredAtLabel: display.dateTimeLabel(item.occurred_at),
      counterpartyLabel: agentCourseLedgerDetail(item, agentCharges) || ledgerCounterpartyLabel(item, targetId)
    })),
    // 定制课程余额不够时记下的欠款（还没补扣的部分）；之后账户再有积分会先自动补扣
    debt: roundedCredits(payload.debt),
    orders: (payload.orders || []).map((item) => ({
      ...item,
      amountDisplay: decimalText(item.amount),
      statusLabel: orderStatusLabel(item.status),
      beneficiaryName: item.beneficiary_student && (item.beneficiary_student.nickname || item.beneficiary_student.real_name) || '当前学生',
      payment: (item.payments || [])[0] ? { ...item.payments[0], statusLabel: display.statusLabel(item.payments[0].status) } : null,
      createdAtLabel: display.dateTimeLabel(item.created_at),
      fulfilledAtLabel: display.dateTimeLabel(item.fulfilled_at),
      batches: item.credit_batches || [],
      ledger: item.credit_ledger_entries || []
    })),
    attribution: payload.attribution ? {
      ...payload.attribution,
      sourceLabel: display.sourceLabel(payload.attribution.source_type),
      promoter: payload.attribution.promoter_profile || null
    } : null
  }
}

function orderStatusLabel(status) {
  const labels = {
    '待支付': '待支付',
    '已支付': '已支付',
    '已取消': '已关闭',
    '已退款': '已退款'
  }
  return labels[status] || display.statusLabel(status)
}

async function loadOrders() {
  const account = await loadCurrentCreditAccount()
  return account.orders || []
}

// 买积分包只要有推荐人（2026-09-25 用户规则，与开通会员同一口径）：填过邀请码、扫码或分享卡片带来的都算，
// 推荐人不必是已开通的推广伙伴（普通用户的邀请码对应的推广档案是 inactive）。下单时后端同样要求有推荐人归因。
async function loadPurchaseEligibility() {
  const account = await loadCurrentCreditAccount()
  const attribution = account.attribution
  const promoter = attribution && attribution.promoter
  return {
    eligible: Boolean(attribution && promoter),
    // 积分包页顶部显示当前可用积分（同一次读取，不另发请求）
    balance: account.account,
    attribution,
    promoter: promoter ? {
      name: promoter.display_name || '邀请人',
      serviceContact: promoter.service_contact || '',
      promotionCode: promoter.promotion_code || ''
    } : null
  }
}

async function loadOrderDetail(orderId) {
  const targetId = String(orderId || '')
  if (!targetId) throw new Error('订单编号无效。')
  const orders = await loadOrders()
  const order = orders.find((item) => String(item.id) === targetId)
  if (!order) throw new Error('未找到该订单，或你没有查看权限。')
  return order
}

// 「我的」页等处的账号资料。还没完善学习档案的账号也照常返回（completed: false），
// 页面据此提示去完善，积分、金币等账户信息照常显示，不把整页当成读取失败。
async function loadMeDashboard() {
  const currentUser = await loadCurrentUser()
  const completed = Boolean(currentUser.profileCompleted && currentUser.profile)
  const profile = currentUser.profile || {}
  const student = completed ? {
    id: profile.id,
    name: profileDisplayName(profile),
    relation: '本人',
    initial: profileInitial(profile),
    gradeLabel: profileGradeLabel(profile)
  } : null
  let creditAccount = null
  try {
    creditAccount = await loadCurrentCreditAccount()
  } catch (error) {
    // An account is only created after a successful entitlement event.
  }
  return {
    profile: {
      id: profile.id || null,
      publicId: profile.public_id || '',
      displayName: profileDisplayName(profile),
      initial: profileInitial(profile),
      avatarUrl: profile.avatar_url || profile.avatar && profile.avatar.url || '',
      roleLabel: '学生本人',
      accountType: profile.account_type === 'guardian' ? 'guardian' : 'student',
      // 家长不显示年级（切换为家长后学生资料会保留，但不是家长自己的年级）
      gradeLabel: !completed ? '' : profile.account_type === 'guardian' ? '家长' : `${profileGradeLabel(profile)}${profile.textbook_version ? ` · ${profile.textbook_version}` : ''}`,
      identityLabel: completed ? '学习档案完整' : '学习资料未完善',
      completed
    },
    currentStudentId: student ? student.id : null,
    students: student ? [student] : [],
    balances: creditAccount ? {
      coursePoints: creditAccount.account.available,
      frozenPoints: creditAccount.account.frozen
    } : null,
    childUpdate: null
  }
}

function wholeNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number) : 0
}

async function loadCurrentGrowthCenter() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_GROWTH_CENTER
  )) || {}

  if (payload.status && payload.status !== 'ready') {
    throw new Error('推广与金币中心暂时不可读取，请稍后重试。')
  }

  const coinAccount = payload.coinAccount || {}
  const partner = payload.partner || {}
  return {
    student: payload.student || null,
    promoter: payload.promoter || null,
    coinAccount: {
      status: coinAccount.status || 'inactive',
      available: wholeNumber(coinAccount.available_coins),
      frozen: wholeNumber(coinAccount.frozen_coins),
      withdrawn: wholeNumber(coinAccount.withdrawn_coins),
      expired: wholeNumber(coinAccount.expired_coins)
    },
    coinLedger: (payload.coinLedger || []).map(item => ({ ...item, businessLabel: display.businessLabel(item.business_type, item.entry_type, 'coin') })),
    withdrawals: (payload.withdrawals || []).map(item => ({
      ...item,
      statusLabel: display.statusLabel(item.status, 'withdrawal'),
      amountLabel: Number.isFinite(Number(item.net_amount)) ? `¥${Number(item.net_amount).toFixed(2)}` : ''
    })),
    redemptionRecords: (payload.redemptionRecords || []).map(item => ({ ...item, statusLabel: display.statusLabel(item.status, 'redemption') })),
    rewards: partner.rewards || [],
    elections: partner.elections || [],
    giftAccount: partner.giftAccount || null,
    gifts: partner.gifts || [],
    recoveries: partner.recoveries || [],
    invitations: (partner.invitations || []).map(item => ({ ...item, statusLabel: display.statusLabel(item.status), sceneLabel: display.sceneLabel(item.scene_type) })),
    clients: (partner.clients || []).map(item => ({ ...item, statusLabel: display.statusLabel(item.status), sourceLabel: display.sourceLabel(item.source_type) }))
  }
}

async function requestK12Assessment(payload) {
  const result = await invokeActionFlow(config.ACTION_FLOWS.K12_ASSESSMENT, { payload }, { timeout: 60000 })
  const errors = {
    unauthenticated: '请重新登录。', profile_required: '请先完善学习档案。', scope_unavailable: '该范围暂未开放测评。',
    scope_mismatch: '测评范围与当前年级、学期不一致，请重新选择。', bank_not_ready: '题库正在准备，请稍后再来。',
    revision_conflict: '答案状态已更新，请重新加载后继续。', answer_already_saved: '本题答案已经保存。',
    answers_required: '请先完成至少一道题。', attempt_not_found: '没有找到本人的测评记录。',
    attempt_legacy: '这是旧版测评记录，请回到测评列表重新开始。',
    invalid_answer: '请检查答案格式。', invalid_question: '本题暂不可用，请重新加载。'
  }
  if (!result || !['ready', 'submitted'].includes(result.status)) {
    const error = new Error(errors[result && result.status] || '测评操作未完成，请重试。')
    error.code = result && result.status
    throw error
  }
  return result
}

module.exports = {
  loadAgentCoursePractice,
  answerAgentCoursePractice,
  retryAgentCoursePractice,
  loadQuestPath,
  loadHonors,
  openQuestChest,
  getStoredToken,
  hasSession,
  isProfileRequired,
  loadViewerAccess,
  accessOfError,
  requestCourseApi,
  requestCourseUpload,
  requestK12Assessment,
  // 直播间等后加的服务自己组织调用，共用这里的动作流通道与登录态重试
  invokeActionFlow,
  parseActionFlowResult,
  uploadPrivateFile,
  loadCurrentMembership,
  createMembershipOrder,
  resetPhoneSessionVerification,
  signInWithWechat,
  restoreAuthenticatedUser,
  signOut,
  resetDevelopmentAccount,
  unlockDevelopmentReset,
  loadCurrentUser,
  loadHomeDashboard,
  loadLearningDashboard,
  loadKnowledgeMap,
  loadKnowledgeUniverse,
  loadAgentCourseAcceptance,
  sendAgentCourseAcceptance,
  loadAgentCourseReview,
  loadAgentCourseHomework,
  submitAgentCourseHomework,
  retryAgentCourseHomework,
  loadGuardianHomework,
  checkAgentCourseReviewAnswer,
  submitAgentCourseReview,
  finishAgentCourseForTest,
  loadTeacherStudentAgentCourses,
  loadTeacherAgentAcceptance,
  reviewAgentCourseAcceptance,
  loadTeacherStudyPlan,
  updateTeacherStudyPlan,
  loadTeacherStudyAlerts,
  loadTeacherStudyReminder,
  createTeacherStudyReminder,
  loadTeacherParentReports,
  createTeacherParentReport,
  loadTeacherDailyLearning,
  createTeacherDailyNote,
  downloadTeacherParentReport,
  deleteTeacherParentReport,
  pushTeacherParentReport,
  loadGuardianParentReports,
  downloadGuardianParentReport,
  registerServiceAccountLink,
  loadStudyPlanDays,
  buildKnowledgeUniverse,
  loadKnowledgeTopic,
  loadLearnerBaseline,
  loadLearningPreference,
  loadAgentIdentity,
  loadAgentFamilies,
  loadFamilyWechatQr,
  loadShippingAddress,
  saveShippingAddress,
  downloadFamilyWechatQr,
  uploadFamilyWechatQr,
  lookupAgentFamily,
  bindAgentFamily,
  loadAgentTrial,
  openAgentTrialTest,
  requestAgentTrialMeeting,
  loadAgentTrialScript,
  downloadAgentTrialReport,
  loadAgentApplication,
  submitAgentApplication,
  proposeLoveMom,
  saveLearningPreference,
  loadLearningGoal,
  loadGoalDiagnosis,
  loadSpeechAudio,
  goalDiagnosis,
  loadTeacherGoalDiagnosis,
  loadWebChildren,
  createWebChild,
  setWebChildPassword,
  saveLearningGoal,
  loadTeacherLearningPreference,
  loadCreditProducts,
  loadCreditProduct,
  createSecureCreditOrder,
  redeemCurrentStudentCode,
  loadCurrentCreditAccount,
  loadOrders,
  loadOrderDetail,
  loadPurchaseEligibility,
  loadCurrentFamilyRelations,
  createCurrentStudentBindingCode,
  bindCurrentGuardianToStudent,
  loadCurrentIdentityVerification,
  submitCurrentGuardianIdentityVerification,
  loadGuardianDashboard,
  loadCurrentLoginIdentities,
  loadGuardianLearningFeed,
  loadAuthorizedTopicLearningReports,
  authorizeAcceptanceAudio,
  loadCurrentNotifications,
  markCurrentNotificationRead,
  loadPromoterAssignmentRequest,
  submitPromoterAssignmentRequest,
  cancelPromoterAssignmentRequest,
  loadAssessmentCenter,
  loadCurrentDiagnosticReports,
  loadCurrentLearningPlans,
  prepareCourseOutlineReview,
  loadCourseOutline,
  saveCourseOutline,
  cancelCourseOutline,
  createCurrentCourseGenerationQuote,
  confirmCurrentCourseGeneration,
  loadCurrentRemediationTasks,
  loadCurrentLiveSchedule,
  loadCurrentTopicCandidates,
  addCurrentTopicCandidate,
  removeCurrentTopicCandidate,
  loadCurrentServiceContacts,
  loadCurrentTeacherWorkspace,
  bindStudentAsCurrentTeacher,
  loadTeacherStudentProfile,
  loadTeacherStudentAssessments,
  loadTeacherStudentAssessment,
  saveTeacherStudentProfile,
  cancelTeacherAgentInvite,
  uploadTeacherInviteVoice,
  saveTeacherInviteVoice,
  saveTeacherInviteDetails,
  createTeacherAgentInvite,
  loadTeacherAgentInvite,
  markTeacherAgentSession,
  createCourseLaunchUrl,
  createLibraryCourseLaunchUrl,
  createAgentCourseLaunchUrl,
  loadAgentCourses,
  loadAgentCourse,
  loadMemberCourseLibrary,
  loadCourseCovers,
  createAcceptanceLaunchUrl,
  createCurrentFeynmanAcceptance,
  uploadCurrentAcceptanceAudio,
  generateCurrentLearningPlan,
  startOrResumeBasicAssessment,
  saveCurrentAssessmentAnswer,
  submitCurrentBasicAssessment,
  loadCurrentAssessmentScores,
  saveCurrentAssessmentScore,
  saveCurrentAssessmentExamFiles,
  saveCurrentAssessmentOcrReview,
  uploadAssessmentImage,
  loadMeDashboard,
  loadCurrentGrowthCenter,
  generateCurrentPromoterPosterBackground,
  loadPublishedPromotionAssets,
  loadCurrentPromotionCode,
  loadCurrentPromotionPosterParts,
  bindCurrentPromotionCode,
  loadCurrentReferrer,
  claimCurrentDailyCoinCheckin,
  loadCurrentLearningCheckin,
  useCurrentStreakCard,
  createCurrentPromoterInvitation,
  recordCurrentPromotionTouchAndAttribute,
  saveCurrentLearningProfile,
  startWechatPaymentTest,
  payWechatOrder,
  isWechatPaymentCancelled,
  isAuthenticationRequired
}
