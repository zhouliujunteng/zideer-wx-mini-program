/**
 * OpenMAIC 课程智能体控制面客户端（方案 A：小程序作为 agent-runtime 的新前端）。
 *
 * 端点与语义与 OpenMAIC-sync 的 app/api/agent/sessions/* 对齐：
 *   POST /api/agent/sessions                      建会话（202 + 会话元数据）
 *   POST /api/agent/sessions/:id/messages         追加消息（202）
 *   POST /api/agent/sessions/:id/cancel           取消当前 run
 *   GET  /api/agent/sessions/:id                  会话元数据
 *   GET  /api/agent/skills                        技能清单
 *   GET  /api/agent/sessions/:id/events?lastEventId=  SSE 事件流（支持断点续传）
 *
 * 身份：服务端按匿名 anonymous_id cookie 划分会话归属。wx.request 会自动带
 * cookie，这里再显式持久化一份（storage），双保险且便于真机排查。
 */
const { COURSE_PORTAL_ORIGIN } = require('../config/index')
const { createAgentSseStream } = require('../utils/agent-sse')

const COURSE_AGENT = {
  origin: COURSE_PORTAL_ORIGIN,
  requestTimeoutMs: 20000,
  // 服务端 SSE 心跳 25s、路由 maxDuration 300s；客户端 305s 兜底后由页面重连。
  streamTimeoutMs: 305000,
  reconnectDelaysMs: [1500, 4000, 8000],
  storageKeys: {
    cookie: 'course-agent-anonymous-cookie',
    session: 'course-agent-session-id',
    access: 'course-agent-access-token',
  },
}

function readCookie() {
  try {
    return String(wx.getStorageSync(COURSE_AGENT.storageKeys.cookie) || '')
  } catch {
    return ''
  }
}

function readAccessToken() {
  try {
    return String(wx.getStorageSync(COURSE_AGENT.storageKeys.access) || '')
  } catch {
    return ''
  }
}

/** 出站 Cookie：匿名身份 + 访问码凭证（网关按 openmaic_access 放行 /api/agent/*）。 */
function readAgentCookieHeader() {
  const parts = []
  const anonymous = readCookie()
  const access = readAccessToken()
  if (anonymous) parts.push(anonymous)
  if (access) parts.push(`openmaic_access=${access}`)
  return parts.join('; ')
}

function storeCookieFromHeader(header) {
  if (!header) return
  const raw = header['Set-Cookie'] || header['set-cookie']
  if (!raw) return
  const list = Array.isArray(raw) ? raw : [raw]
  const match = list
    .join(';')
    .match(/anonymous_id=[^;]+/)
  if (match) {
    try {
      wx.setStorageSync(COURSE_AGENT.storageKeys.cookie, match[0])
    } catch {
      // storage 不可用时退回 wx.request 的自动 cookie 管理
    }
  }
}

/**
 * 用 Zion 用户 JWT 换课程智能体的访问凭证（openmaic_access）。
 * 后端会拿 JWT 调 Zion 数据查询探针，无效凭证换不到 token。
 * token 缓存在 storage；401 时由页面调 clearCourseAgentAccess() 触发重换。
 */
function ensureCourseAgentAccess(zionToken) {
  const cached = readAccessToken()
  if (cached) return Promise.resolve(cached)
  if (!zionToken) return Promise.reject(new Error('请先完成微信登录后再使用 AI 对话'))
  return new Promise((resolve, reject) => {
    wx.request({
      url: `${COURSE_AGENT.origin}/api/learn/agent-session`,
      method: 'POST',
      timeout: COURSE_AGENT.requestTimeoutMs,
      header: { 'content-type': 'application/json', Authorization: `Bearer ${zionToken}` },
      data: {},
      success(response) {
        storeCookieFromHeader(response.header)
        const status = response.statusCode || 0
        const body = response.data
        if (status >= 200 && status < 300 && body && body.success) {
          const token = String(body.token || '')
          if (token) {
            try {
              wx.setStorageSync(COURSE_AGENT.storageKeys.access, token)
            } catch {
              // 缓存失败不阻断：本次直接返回，下次重新换取
            }
          }
          resolve(token)
          return
        }
        reject(new Error((body && body.error) || '登录校验失败，请稍后重试'))
      },
      fail(cause) {
        reject(new Error((cause && cause.errMsg) || '登录校验请求失败'))
      },
    })
  })
}

function clearCourseAgentAccess() {
  try {
    wx.removeStorageSync(COURSE_AGENT.storageKeys.access)
  } catch {
    // 忽略：下次换取会覆盖
  }
}

function requestJson(path, { method = 'GET', body, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' }
    const cookie = readAgentCookieHeader()
    if (cookie) header.Cookie = cookie
    wx.request({
      url: `${COURSE_AGENT.origin}${path}`,
      method,
      timeout: timeoutMs || COURSE_AGENT.requestTimeoutMs,
      header,
      data: body,
      success(response) {
        storeCookieFromHeader(response.header)
        const status = response.statusCode || 0
        if (status >= 200 && status < 300) {
          resolve(response.data)
          return
        }
        const message =
          (response.data && (response.data.error || response.data.errorCode)) ||
          `课程智能体请求失败（HTTP ${status}）`
        const error = new Error(String(message))
        error.statusCode = status
        error.body = response.data
        reject(error)
      },
      fail(cause) {
        reject(new Error((cause && cause.errMsg) || '网络连接失败'))
      },
    })
  })
}

function createCourseAgentSession({ prompt, skill } = {}) {
  const body = { prompt }
  if (skill) body.skill = skill
  return requestJson('/api/agent/sessions', { method: 'POST', body })
}

function sendCourseAgentMessage(sessionId, text) {
  return requestJson(`/api/agent/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: { text },
  })
}

function cancelCourseAgentSession(sessionId) {
  return requestJson(`/api/agent/sessions/${encodeURIComponent(sessionId)}/cancel`, {
    method: 'POST',
    body: {},
  })
}

function fetchCourseAgentSession(sessionId) {
  return requestJson(`/api/agent/sessions/${encodeURIComponent(sessionId)}`)
}

/** 当前身份的会话清单（AgentSessionMeta[]：id/prompt/status/updatedAt…）。 */
function listCourseAgentSessions() {
  return requestJson('/api/agent/sessions')
}

function fetchCourseAgentSkills() {
  return requestJson('/api/agent/skills')
}

/**
 * 订阅会话事件流。onEvent 收到的是服务端持久事件对象 {id, ts, type, data}；
 * onStatus(state, detail) 报告 'live' | 'closed' | 'error' 供页面决定重连。
 * 返回 { abort }；重连由页面用 fold 状态里的 lastEventId 重新发起。
 */
function streamCourseAgentEvents(sessionId, { lastEventId = 0, onEvent, onStatus } = {}) {
  const stream = createAgentSseStream()
  let task = null
  let aborted = false
  const header = { Accept: 'text/event-stream' }
  const cookie = readAgentCookieHeader()
  if (cookie) header.Cookie = cookie

  const dispatch = (frames) => {
    frames.forEach((frame) => {
      if (!frame.event) return
      if (frame.event === 'caught_up') {
        if (onStatus) onStatus('live', frame.data)
        return
      }
      const payload = frame.data && typeof frame.data === 'object' ? frame.data : {}
      if (onEvent) {
        onEvent({
          id: Number(frame.id) || Number(payload.id) || 0,
          ts: Number(payload.ts) || 0,
          type: String(frame.event),
          data: payload.data !== undefined ? payload.data : payload,
        })
      }
    })
  }

  task = wx.request({
    url: `${COURSE_AGENT.origin}/api/agent/sessions/${encodeURIComponent(sessionId)}/events?lastEventId=${Number(lastEventId) || 0}`,
    method: 'GET',
    enableChunked: true,
    timeout: COURSE_AGENT.streamTimeoutMs,
    header,
    success(res) {
      if (aborted) return
      // 404/401 等错误状态：事件流没有正文帧，必须把状态码带给调用方终态处理
      if (onStatus) onStatus(res && res.statusCode >= 400 ? 'fatal' : 'closed', res)
    },
    fail(cause) {
      if (!aborted && onStatus) onStatus('error', cause)
    },
  })

  // 分块回调只能挂在 RequestTask 上：wx.request 的参数里没有 onChunkReceived，
  // 写在参数里真机上永远收不到分块，页面会一直停在加载中直到服务端 300s 断开。
  if (task && typeof task.onChunkReceived === 'function') {
    task.onChunkReceived((res) => {
      if (aborted) return
      dispatch(stream.feed((res && res.data) || new Uint8Array(0)))
    })
  } else if (onStatus) {
    onStatus('error', new Error('当前微信版本不支持分块接收，请升级微信后重试'))
  }

  return {
    abort() {
      aborted = true
      try {
        if (task && typeof task.abort === 'function') task.abort()
      } catch {
        // abort 失败不影响：aborted 标志已挡住后续分发
      }
    },
  }
}

/** 保存/读取当前会话 id：退出再进可以续上同一条对话（cookie 身份一致时可见）。 */
function rememberCourseAgentSession(sessionId) {
  try {
    wx.setStorageSync(COURSE_AGENT.storageKeys.session, sessionId || '')
  } catch {
    // 忽略：会话不可恢复只是体验降级
  }
}

function recallCourseAgentSession() {
  try {
    return String(wx.getStorageSync(COURSE_AGENT.storageKeys.session) || '')
  } catch {
    return ''
  }
}

function forgetCourseAgentSession() {
  rememberCourseAgentSession('')
}

/**
 * 演示模式事件时间线：后端开关未开时预览伪思考流的完整体验。
 * 事件结构与真实 SSE 完全一致，页面代码零分叉。
 */
const MOCK_SESSION_ID = 'mock-session'

const MOCK_TIMELINE = [
  { delay: 300, type: 'session_start', data: {} },
  { delay: 250, type: 'user_message', data: { text: '帮我做一节「分数加减」的小学五年级数学课' } },
  {
    delay: 500,
    type: 'tool_execution_start',
    data: { toolCallId: 'call-1', toolName: 'web_search', args: { query: '小学五年级 分数加减 教学要点' } },
  },
  {
    delay: 1400,
    type: 'tool_execution_end',
    data: { toolCallId: 'call-1', isError: false, result: { content: [{ type: 'text', text: '8 条来源：同分母先加减、异分母通分、约分最简…' }] } },
  },
  {
    delay: 400,
    type: 'tool_execution_start',
    data: { toolCallId: 'call-2', toolName: 'create_stage', args: { title: '分数加减——从同分母到通分' } },
  },
  { delay: 300, type: 'trace', data: { message: '大纲规划中：6 页，含 1 个互动练习' } },
  {
    delay: 1200,
    type: 'tool_execution_end',
    data: { toolCallId: 'call-2', isError: false, result: { content: [{ type: 'text', text: 'stage stage-mock9f2c1 已创建' }], details: { stageId: 'stage-mock9f2c1' } } },
  },
  {
    delay: 350,
    type: 'tool_execution_start',
    data: { toolCallId: 'call-3', toolName: 'set_roster', args: {} },
  },
  { delay: 900, type: 'trace', data: { message: '讲解老师与两位同学已就位' } },
  {
    delay: 800,
    type: 'tool_execution_end',
    data: { toolCallId: 'call-3', isError: false, result: { content: [{ type: 'text', text: '讲解角色已配置' }] } },
  },
  {
    delay: 1800,
    type: 'user_question',
    data: {
      question: '互动练习页想用哪种形式？',
      options: [
        { id: 'quiz', label: '随堂小测（4 道选择题）' },
        { id: 'drag', label: '拖拽配对（通分练习）' },
        { id: 'skip', label: '先不要互动页' },
      ],
      multiSelect: false,
    },
  },
]

/** 演示时间线的收尾段：用户作答后由页面触发。 */
const MOCK_TIMELINE_AFTER_ANSWER = [
  { delay: 300, type: 'user_message', data: { text: '随堂小测（4 道选择题）' } },
  { delay: 400, type: 'session_resumed', data: {} },
  {
    delay: 600,
    type: 'tool_execution_start',
    data: {
      toolCallId: 'call-5',
      toolName: 'start_course_generation',
      args: { stageId: 'stage-mock9f2c1', pages: [1, 2, 3, 4, 5, 6].map((order) => ({ order, title: `第 ${order} 页`, type: order === 5 ? 'quiz' : 'slide', brief: '…' })) },
    },
  },
  {
    delay: 1600,
    type: 'tool_execution_end',
    data: { toolCallId: 'call-5', isError: false, result: { content: [{ type: 'text', text: '已提交后台生成（6 页）' }] } },
  },
  {
    delay: 1600,
    type: 'course_generation',
    data: { stageId: 'stage-mock9f2c1', title: '分数加减——从同分母到通分', url: '/classroom/stage-mock9f2c1', totalPages: 6, status: 'generating' },
  },
  {
    delay: 300,
    type: 'message_update',
    data: { message: { role: 'assistant', content: [{ type: 'text', text: '课程《分数加减——从同分母到通分》正在生成中，共 6 页：' }] } },
  },
  {
    delay: 400,
    type: 'message_update',
    data: {
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '课程《分数加减——从同分母到通分》正在生成中，共 6 页：\n\n- 第 1–2 页：同分母加减，从蛋糕切分的例子切入\n- 第 3 页：异分母为什么要通分\n- 第 4 页：**通分三步法**（找最简公分母→改写→相加减）\n- 第 5 页：随堂小测（4 道选择题，你选的形式）\n- 第 6 页：本课要点回顾\n\n点上面的课程卡片可以查看实时生成进度，「学习 › 我的课程」里也已经能看到这门课。' },
        ],
      },
    },
  },
  // message_end 携带最终完整消息（pi 协议语义：快照替换而非增量）
  { delay: 200, type: 'message_end', data: { message: { role: 'assistant', content: [{ type: 'text', text: '课程《分数加减——从同分母到通分》正在生成中，共 6 页：\n\n- 第 1–2 页：同分母加减，从蛋糕切分的例子切入\n- 第 3 页：异分母为什么要通分\n- 第 4 页：**通分三步法**（找最简公分母→改写→相加减）\n- 第 5 页：随堂小测（4 道选择题，你选的形式）\n- 第 6 页：本课要点回顾\n\n点上面的课程卡片可以查看实时生成进度，「学习 › 我的课程」里也已经能看到这门课。' }] } } },
  { delay: 250, type: 'session_end', data: { status: 'succeeded' } },
]

/** 按时间线播放事件；返回 { cancel }。answer() 播放作答后的下半场。 */
function playMockCourseAgentTimeline(onEvent) {
  let seq = 0
  let cancelled = false
  const timers = []
  // delay 是相邻事件间的间隔，必须累计调度，否则乱序触发
  const schedule = (entries) => {
    let elapsed = 0
    entries.forEach((entry) => {
      elapsed += entry.delay
      timers.push(
        setTimeout(() => {
          if (cancelled) return
          seq += 1
          onEvent({ id: seq, ts: Date.now(), type: entry.type, data: entry.data })
        }, elapsed),
      )
    })
  }
  schedule(MOCK_TIMELINE)
  return {
    answer() {
      schedule(MOCK_TIMELINE_AFTER_ANSWER)
    },
    cancel() {
      cancelled = true
      timers.forEach((timer) => clearTimeout(timer))
    },
  }
}

module.exports = {
  COURSE_AGENT,
  MOCK_SESSION_ID,
  createCourseAgentSession,
  sendCourseAgentMessage,
  cancelCourseAgentSession,
  fetchCourseAgentSession,
  listCourseAgentSessions,
  fetchCourseAgentSkills,
  streamCourseAgentEvents,
  rememberCourseAgentSession,
  recallCourseAgentSession,
  forgetCourseAgentSession,
  ensureCourseAgentAccess,
  clearCourseAgentAccess,
  readAgentCookieHeader,
  playMockCourseAgentTimeline,
}
