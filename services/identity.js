const config = require('../config/index')
const { courseGenerationState, courseCreditState, courseTaskProgress } = require('../utils/course-state')
const { isEnterpriseWechatContact } = require('../utils/customer-service')
const display = require('../utils/business-labels')
const { summarizeLearnerBaseline } = require('../utils/learner-baseline')
const { isAgentCourseId, normalizeAgentCourse } = require('../utils/agent-course-view')

const TOKEN_KEY = 'zion_runtime_token'
let authRedirectInProgress = false
let verifiedPhoneToken = ''
let phoneVerificationFlight = null
let identityVerificationFlight = null
let sessionGeneration = 0

function resetPhoneSessionVerification() { verifiedPhoneToken = ''; phoneVerificationFlight = null }

function createAuthenticationRequiredError() {
  const error = new Error('登录状态已失效，请重新登录。')
  error.code = 'AUTH_REQUIRED'
  return error
}

function currentRoute() {
  if (typeof getCurrentPages !== 'function') return ''
  const pages = getCurrentPages()
  const page = pages && pages[pages.length - 1]
  return page && page.route ? String(page.route) : ''
}

function requireAuthentication() {
  sessionGeneration += 1
  wx.removeStorageSync(TOKEN_KEY)
  resetPhoneSessionVerification()
  if (typeof getApp === 'function') { const app = getApp(); if (app && app.globalData) app.globalData.user = null }

  // All protected pages use this recovery path, so expired sessions do not
  // present themselves as business-data loading failures.
  if (!authRedirectInProgress && currentRoute() !== 'pages/login/login') {
    authRedirectInProgress = true
    try {
      wx.reLaunch({ url: '/pages/login/login' })
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

async function resetDevelopmentAccount() {
  const result = await invokeActionFlow(config.ACTION_FLOWS.RESET_DEVELOPMENT_ACCOUNT, {}, { timeout: 20000 })
  if (result && result.status && result.status !== 'reopened') throw new Error('开发账号重开未完成，请稍后重试。')

  sessionGeneration += 1
  resetPhoneSessionVerification()
  authRedirectInProgress = false
  if (typeof getApp === 'function') {
    const app = getApp()
    if (app && app.globalData) app.globalData.user = null
  }
  wx.clearStorageSync()
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
      MEMBERSHIP_ALREADY_ACTIVE: '你已是会员，无需再次开通，可购买积分包补充积分。', MEMBERSHIP_TIER_UNAVAILABLE: '该会员等级已下架或价格已更新，请刷新后重新选择。' }
    const key = Object.keys(messages).find(key => String(error.message).includes(key))
    throw new Error(key ? messages[key] : '会员状态暂时无法确认，请稍后重新查询。')
  }
  if (getStoredToken() !== token) throw new Error('账号已变化，请重新打开会员页面。')
  if (!result || typeof result.eligible !== 'boolean' || !['active', 'inactive', 'expired', 'pending', 'refunded', 'closed'].includes(result.status)
    || !Array.isArray(result.tiers) || !result.tiers.every(tier => validMembershipTier(tier) && /^[1-9][0-9]*$/.test(String(tier.productVersionId)))
    || (result.tier && !validMembershipTier(result.tier))
    || (result.order && (!/^[1-9][0-9]*$/.test(String(result.order.orderId)) || !(Number(result.order.amount) > 0)))
    || (result.eligible && (!result.tier || (result.permanent !== true && !Number.isFinite(Date.parse(result.expiresAt)))))) {
    throw new Error('会员信息暂不可用，请重新查询。')
  }
  return { ...result, order: result.order ? { ...result.order, statusLabel: orderStatusLabel(result.order.status) } : result.order }
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

// 小程序内打开课程：用当前登录向课程服务换一次性入场券（60 秒、单次有效），
// web-view 打开即完成鉴权，不再需要回小程序确认学习设备。换券失败时回落到不含凭证的课程地址，
// 由课程页面走原有的设备确认流程。
async function createLearnerEntryUrl(reference, query) {
  const token = await getRuntimeToken()
  const origin = coursePortalOrigin()
  const plainUrl = `${origin}/learn?${query}&layout=focus`
  try {
    const data = await request({
      url: `${origin}/api/learn/device`,
      data: { operation: 'handoff', ...reference },
      header: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      timeout: 15000
    })
    const ticket = data && data.ticket
    if (getStoredToken() !== token || typeof ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket)) return plainUrl
    return `${origin}/api/learn/entry?${query}&layout=focus&ticket=${ticket}`
  } catch (error) {
    return plainUrl
  }
}

// 可复制/分享的课程地址：去掉一次性入场券，只保留课程定位。
function courseShareUrl(launchUrl) {
  return String(launchUrl || '')
    .replace('/api/learn/entry?', '/learn?')
    .replace(/&ticket=[A-Za-z0-9_-]*/, '')
}

async function createCourseLaunchUrl(courseInstanceId) {
  const normalizedCourseInstanceId = Number(courseInstanceId)
  if (!Number.isSafeInteger(normalizedCourseInstanceId) || normalizedCourseInstanceId <= 0) {
    throw new Error('课程信息不完整，请刷新后重试。')
  }
  return createLearnerEntryUrl({ courseInstanceId: normalizedCourseInstanceId }, `course=${normalizedCourseInstanceId}`)
}

async function createAgentCourseLaunchUrl(stageId) {
  if (!isAgentCourseId(stageId)) throw new Error('课程信息不完整，请刷新后重试。')
  return createLearnerEntryUrl({ agentCourseId: stageId }, `agent=${stageId}`)
}

// 智能体课程接口同时带登录态与智能体的匿名身份：后者用于把这台设备上刚生成的课程
// 绑定到当前学习者（见课程服务 lib/course/agent-course-access.ts）。
function requestAgentCourses(path, token) {
  const { readAgentCookieHeader } = require('./course-agent-service')
  const header = { authorization: `Bearer ${token}` }
  const cookie = readAgentCookieHeader()
  if (cookie) header.Cookie = cookie
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}${path}`, method: 'GET', timeout: 15000, header,
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请重新打开课程。'))
      if (response.statusCode === 200 && response.data) return resolve(response.data)
      const messages = { LOGIN_REQUIRED: '请重新登录后查看课程。', AGENT_COURSE_NOT_FOUND: '没有找到这门课程，可能还没有开始生成。', COURSE_ACCESS_DENIED: '当前学习账号暂不可访问这门课程。' }
      const code = response.data && response.data.code
      const error = new Error(messages[code] || '课程进度暂时无法读取，请稍后重试。')
      error.code = code
      error.statusCode = response.statusCode
      reject(error)
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

/** 「我的课程」里的智能体课程（含生成中的课程及进度），最新的在前。 */
async function loadAgentCourses() {
  const token = await getRuntimeToken()
  const data = await requestAgentCourses('/api/learn/agent-courses', token)
  return (Array.isArray(data.courses) ? data.courses : []).map(normalizeAgentCourse).filter(Boolean)
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

async function loadMemberCourseLibrary() {
  const token = await getRuntimeToken()
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/library`, method: 'GET', timeout: 20000,
    header: { authorization: `Bearer ${token}` },
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
      resolve(courses.map((course) => ({ id: course.id, title: course.title, subject: String(course.subject || ''), grade: String(course.grade || '') })))
    },
    fail(error) { reject(courseConnectionError(error)) }
  }))
}

async function approveCourseDevice(code) {
  const normalized = String(code || '').replace(/\s/g, '').toUpperCase()
  if (!/^[A-F0-9]{12}$/.test(normalized)) throw new Error('请输入完整的12位设备确认码。')
  const token = await getRuntimeToken()
  return new Promise((resolve, reject) => wx.request({
    url: `${coursePortalOrigin()}/api/learn/device`, method: 'POST', timeout: 20000,
    header: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    data: { operation: 'approve', code: normalized },
    success(response) {
      if (getStoredToken() !== token) return reject(new Error('学习账号已变化，请回到课程页核对设备授权。'))
      if (response.statusCode === 200 && response.data && response.data.approved === true) return resolve(true)
      const messages = { 401: '登录已过期，请重新登录后确认。', 403: '当前账号无权学习这节课程。', 410: '确认码已过期，请在课程页面重新获取。', 429: '操作过于频繁，请稍后重试。' }
      reject(new Error(messages[response.statusCode] || '设备确认失败，请稍后重试。'))
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
    profile_completed_at: profile.profile_completed_at || null
  }
}

function buildCurrentUser(userPrincipalId, profile) {
  const normalizedProfile = normalizeProfile(profile)
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

function signOut() {
  sessionGeneration += 1
  wx.removeStorageSync(TOKEN_KEY)
  resetPhoneSessionVerification()
  authRedirectInProgress = false
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
  if (Object.prototype.hasOwnProperty.call(form, 'gender')) {
    if (!['male', 'female'].includes(form.gender)) throw new Error('请选择性别。')
    details.gender = form.gender
  }
  if (form.avatarPath) details.avatar_id = await uploadProfileAvatar(form.avatarPath, sessionToken)
  if (Object.keys(details).length) payload.personal_details = details
  if (!sessionToken || getStoredToken() !== sessionToken) throw new Error('登录账号已变化，请重新进入个人资料后保存。')

  const userProfileId = parseActionFlowResult(
    await invokeActionFlow(config.ACTION_FLOWS.SAVE_CURRENT_LEARNING_PROFILE, payload, { expectedToken: sessionToken })
  )
  const profile = await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE, {}, { expectedToken: sessionToken })
  if (getStoredToken() !== sessionToken) throw new Error('登录账号已变化，请重新读取个人资料。')
  const saved = normalizeProfile(parseActionFlowResult(profile))
  if (!saved || String(saved.id) !== String(userProfileId) || saved.nickname !== payload.nickname || Number(saved.current_grade) !== payload.grade || saved.semester !== payload.semester ||
      (Object.prototype.hasOwnProperty.call(details, 'birthday') && saved.birthday !== (details.birthday || '')) ||
      (Object.prototype.hasOwnProperty.call(details, 'gender') && saved.gender !== details.gender) ||
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
    throw new Error('请先完善学习档案。')
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
      coverUrl: typeof course.coverUrl === 'string' ? course.coverUrl : '',
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
        coverUrl: typeof course?.coverUrl === 'string' ? course.coverUrl : '',
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
    submitted: '已提交',
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
  if (payload.status !== 'ready') throw new Error('请先完善学习档案后查看知识图谱。')
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
  const diagnosticScope=diagnosticScopes.find(s=>s.entry&&s.entry.mode==='resume')||diagnosticScopes.find(s=>s.entry&&s.entry.mode==='report')||diagnosticScopes[0]
  const diagnostic=diagnosticScope?{...diagnosticScope.entry,scopeId:diagnosticScope.id,subject:activeSubjectKey}:{mode:'unavailable',subject:activeSubjectKey}

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

async function loadKnowledgeMap(subjectKey) {
  let payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP))

  // A newly authenticated WeChat account can reach this page before Zion has
  // created its business-user mapping. Initialize it once and retry the read;
  // never turn this recoverable state into a client-side logout.
  if (payload && payload.status === 'unauthenticated') {
    await loadCurrentUser()
    payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP))
  }

  return buildKnowledgeMap(payload, subjectKey)
}

// 智能体备课用的学习基本盘：学习档案 + 全学科知识点掌握证据，压成紧凑摘要。
// 两个读取各自容错：图谱失败时仍带上年级学期，由智能体通过摸底补齐。
async function loadLearnerBaseline() {
  const [profileResult, mapResult] = await Promise.allSettled([
    invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_LEARNING_PROFILE),
    invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_STUDENT_KNOWLEDGE_MAP)
  ])
  const profile = profileResult.status === 'fulfilled' ? normalizeProfile(parseActionFlowResult(profileResult.value)) : null
  const knowledgeMap = mapResult.status === 'fulfilled' ? parseActionFlowResult(mapResult.value) : null
  if (!profile && !knowledgeMap) throw (profileResult.reason || mapResult.reason || new Error('学习基本盘读取失败'))
  return summarizeLearnerBaseline(profile, knowledgeMap)
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
  if (payload.status === 'not_initialized') throw new Error('请先完善学习档案后查看学习打卡。')
  const dayPattern = /^\d{4}-\d{2}-\d{2}$/
  if (payload.status !== 'ready' || !dayPattern.test(String(payload.today || ''))) {
    throw new Error('学习打卡暂时无法读取，请稍后重试。')
  }
  return {
    today: String(payload.today),
    thresholdSeconds: wholeNumber(payload.thresholdSeconds),
    todaySeconds: wholeNumber(payload.todaySeconds),
    checkedDates: (Array.isArray(payload.checkedDates) ? payload.checkedDates : [])
      .map(String).filter((day) => dayPattern.test(day))
  }
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
      student: relation.student_profile || null
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
    invalid_code: '绑定码无效，请向学生重新获取。',
    expired: '绑定码已过期，请向学生重新获取。',
    already_used: '绑定码已被使用，请向学生重新获取。',
    self_binding_forbidden: '不能绑定自己的学生档案。',
    already_bound: '该学生已经在你的家庭关系中。',
    relation_inactive: '该家庭关系当前不可用，请联系客服处理。'
  }

  if (payload.status !== 'bound') {
    throw new Error(messages[payload.status] || '绑定学生失败，请稍后重试。')
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

  if (!payload.success) throw new Error(payload.message || '实名认证未通过，请核对信息后重试。')

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

async function loadGuardianDashboard() {
  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.GET_CURRENT_GUARDIAN_DASHBOARD
  )) || {}

  return {
    status: payload.status || 'no-active-children',
    children: (payload.children || []).map((relation) => {
      const profile = relation.student_profile || {}
      return {
        relationId: relation.id,
        relationshipType: relation.relationship_type || 'guardian',
        effectiveAt: relation.effective_at || null,
        expiresAt: relation.expires_at || null,
        profile,
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

  const payload = parseActionFlowResult(await invokeActionFlow(
    config.ACTION_FLOWS.CREATE_SECURE_CREDIT_ORDER,
    {
      product_version_id: productVersion,
      beneficiary_student_id: beneficiary,
      idempotency_key: idempotencyKey || createIdempotencyKey()
    }
  )) || {}

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

async function loadCurrentCreditAccount() {
  let payload
  try {
    payload = parseActionFlowResult(await invokeActionFlow(config.ACTION_FLOWS.GET_CURRENT_CREDIT_ACCOUNT)) || {}
  } catch (error) {
    const message = String(error && error.message || '')
    if (/polyglotexception|syntaxerror|missing close quote/i.test(message)) {
      throw new Error('课程积分服务配置异常，请联系管理员处理。')
    }
    throw error
  }
  const account = payload.account || {}
  return {
    studentId: payload.studentId || null,
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
      occurredAtLabel: display.dateTimeLabel(item.occurred_at)
    })),
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

async function loadPurchaseEligibility() {
  const account = await loadCurrentCreditAccount()
  const attribution = account.attribution
  const promoter = attribution && attribution.promoter
  return {
    eligible: Boolean(attribution && promoter && promoter.status === 'active'),
    attribution,
    promoter: promoter ? {
      name: promoter.display_name || '推广伙伴',
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

async function loadMeDashboard() {
  const { profile, student } = await loadCurrentStudentDashboardBase()
  let creditAccount = null
  try {
    creditAccount = await loadCurrentCreditAccount()
  } catch (error) {
    // An account is only created after a successful entitlement event.
  }
  return {
    profile: {
      id: profile.id,
      publicId: profile.public_id,
      displayName: profileDisplayName(profile),
      initial: profileInitial(profile),
      avatarUrl: profile.avatar_url || profile.avatar && profile.avatar.url || '',
      roleLabel: '学生本人',
      gradeLabel: `${profileGradeLabel(profile)}${profile.textbook_version ? ` · ${profile.textbook_version}` : ''}`,
      identityLabel: '学习档案完整'
    },
    currentStudentId: student.id,
    students: [student],
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
    withdrawals: (payload.withdrawals || []).map(item => ({ ...item, statusLabel: display.statusLabel(item.status) })),
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
  getStoredToken,
  requestK12Assessment,
  loadCurrentMembership,
  createMembershipOrder,
  resetPhoneSessionVerification,
  signInWithWechat,
  restoreAuthenticatedUser,
  signOut,
  resetDevelopmentAccount,
  loadCurrentUser,
  loadHomeDashboard,
  loadLearningDashboard,
  loadKnowledgeMap,
  loadKnowledgeTopic,
  loadLearnerBaseline,
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
  createCourseLaunchUrl,
  courseShareUrl,
  createLibraryCourseLaunchUrl,
  createAgentCourseLaunchUrl,
  loadAgentCourses,
  loadAgentCourse,
  loadMemberCourseLibrary,
  approveCourseDevice,
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
  claimCurrentDailyCoinCheckin,
  loadCurrentLearningCheckin,
  createCurrentPromoterInvitation,
  recordCurrentPromotionTouchAndAttribute,
  saveCurrentLearningProfile,
  startWechatPaymentTest,
  payWechatOrder,
  isWechatPaymentCancelled,
  isAuthenticationRequired
}
