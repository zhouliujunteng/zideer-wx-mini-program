const { ZION_AGENT_CONFIG, getGraphqlEndpoint } = require('./zion-agent-config')
const { getAuthSnapshot, ensureZionSession } = require('./zion-auth-service')

const PROJECT_EX_ID = ZION_AGENT_CONFIG.projectExId
const AGENT_CONFIG_ID = ZION_AGENT_CONFIG.agentConfigId
const AGENT_INPUT_ARG_KEY = ZION_AGENT_CONFIG.inputArgKey
const GRAPHQL_ENDPOINT = getGraphqlEndpoint()

/**
 * This module is the only Zion-specific adapter used by the E04 page.
 * Keep GraphQL field names and request sequencing here so a future customer
 * can replace the three values in zion-agent-config.js without touching UI.
 */
function getJwt() {
  return getAuthSnapshot().token
}

function requestGraphql(query, variables) {
  return new Promise((resolve, reject) => {
    const header = { 'content-type': 'application/json' }
    const jwt = getJwt()
    if (jwt) header.Authorization = `Bearer ${jwt}`
    wx.request({
      url: GRAPHQL_ENDPOINT,
      method: 'POST',
      timeout: ZION_AGENT_CONFIG.timeoutMs,
      header,
      data: { query, variables },
      success(response) {
        const body = response && response.data
        if (!body || body.errors || !body.data) {
          const statusCode = response && response.statusCode ? `（HTTP ${response.statusCode}）` : ''
          const error = new Error(`${body && body.errors && body.errors[0] && body.errors[0].message || 'Zion 请求失败'}${statusCode}`)
          error.response = response
          reject(error)
          return
        }
        resolve(body.data)
      },
      fail: reject
    })
  })
}

// The first turn uses the Agent's generated input argKey, not its display name.
function createConversation(text) {
  return requestGraphql(
    `mutation CreateAgentConversation($inputArgs: Map_String_ObjectScalar!, $agentId: String!) {
      fz_zai_create_conversation(inputArgs: $inputArgs, zaiConfigId: $agentId)
    }`,
    { inputArgs: { [AGENT_INPUT_ARG_KEY]: text }, agentId: AGENT_CONFIG_ID }
  ).then((data) => {
    const conversationId = Number(data.fz_zai_create_conversation)
    if (!Number.isFinite(conversationId) || conversationId <= 0) {
      throw new Error('Zion 未返回有效的 conversationId')
    }
    return conversationId
  })
}

// Follow-up turns use the fixed Zion conversation ID and plain text field.
function sendMessage(conversationId, text) {
  return requestGraphql(
    `mutation SendAgentMessage($conversationId: Long!, $text: String) {
      fz_zai_send_ai_message(conversationId: $conversationId, text: $text)
    }`,
    { conversationId: Number(conversationId), text }
  )
}

function readConversation(conversationId) {
  return requestGraphql(
    `query AgentConversationResult($conversationId: Long!) {
      fz_zai_conversation_result(conversationId: $conversationId) {
        conversationId status data reasoningContent
      }
    }`,
    { conversationId: Number(conversationId) }
  ).then((data) => data.fz_zai_conversation_result)
}

function stopConversation(conversationId) {
  return requestGraphql(
    `mutation StopAgentResponse($conversationId: Long!) {
      fz_zai_stop_responding(conversationId: $conversationId)
    }`,
    { conversationId: Number(conversationId) }
  )
}

function listConversations(accountId, options = {}) {
  const normalizedAccountId = Number(accountId)
  if (!Number.isFinite(normalizedAccountId) || normalizedAccountId <= 0) {
    return Promise.reject(new Error('查询 Zion 历史前缺少有效的 accountId'))
  }
  const limit = Math.max(1, Math.min(100, Number(options.limit) || ZION_AGENT_CONFIG.historyLimit))
  return requestGraphql(
    `query ListAgentConversations($where: fz_conversation_bool_exp, $limit: Int, $orderBy: [fz_conversation_order_by!]) {
      fz_conversation(where: $where, limit: $limit, order_by: $orderBy) {
        id created_at updated_at account_id input status ai_config_id ai_model
        messages(order_by: {created_at: asc}) {
          id created_at role conversation_id
          contents(order_by: {created_at: asc}) { id type text json }
        }
      }
    }`,
    {
      where: {
        _and: [
          { account_id: { _eq: normalizedAccountId } },
          { ai_config_id: { _eq: AGENT_CONFIG_ID } }
        ]
      },
      limit,
      orderBy: { created_at: 'desc' }
    }
  ).then((data) => data.fz_conversation || [])
}

function listCurrentUserConversations(options = {}) {
  return ensureZionSession({ allowAnonymous: false }).then((auth) => listConversations(auth.accountId, options))
}

function extractText(result) {
  if (!result) return ''
  if (typeof result.data === 'string') return result.data
  if (result.data && typeof result.data === 'object') {
    return result.data.text || result.data.content || result.data.answer || JSON.stringify(result.data)
  }
  return ''
}

function pollConversation(conversationId, options = {}) {
  const interval = Math.max(500, Number(options.interval) || ZION_AGENT_CONFIG.pollIntervalMs)
  const timeout = Math.max(interval, Number(options.timeout) || ZION_AGENT_CONFIG.timeoutMs)
  const startedAt = Date.now()
  let stopped = false
  let timer = null

  const finish = (resolve, reject, error, result) => {
    if (timer) clearTimeout(timer)
    timer = null
    if (error) reject(error)
    else resolve(result)
  }

  const promise = new Promise((resolve, reject) => {
    const tick = () => {
      if (stopped) {
        finish(resolve, reject, new Error('Zion 对话已停止'))
        return
      }
      readConversation(conversationId).then((result) => {
        if (typeof options.onUpdate === 'function') options.onUpdate(result)
        const status = String(result && result.status || '').toUpperCase()
        if (['COMPLETED', 'FAILED', 'CANCELED'].includes(status)) {
          if (status === 'COMPLETED') finish(resolve, reject, null, result)
          else finish(resolve, reject, new Error(`Zion 对话状态：${status}`), result)
          return
        }
        if (Date.now() - startedAt >= timeout) {
          finish(resolve, reject, new Error('Zion 对话响应超时'), result)
          return
        }
        timer = setTimeout(tick, interval)
      }).catch((error) => finish(resolve, reject, error))
    }
    tick()
  })

  promise.cancel = () => {
    stopped = true
    if (timer) clearTimeout(timer)
  }
  return promise
}

module.exports = {
  ZION_AGENT_CONFIG,
  AGENT_CONFIG_ID,
  AGENT_INPUT_ARG_KEY,
  GRAPHQL_ENDPOINT,
  createConversation,
  sendMessage,
  pollConversation,
  stopConversation,
  listConversations,
  listCurrentUserConversations,
  extractText
}
