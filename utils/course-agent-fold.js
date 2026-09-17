/**
 * 课程智能体事件折叠器（伪思考流核心）。
 *
 * 把 OpenMAIC agent-runtime 的持久会话事件（SSE 具名帧）折叠成小程序可渲染的
 * 时间线节点。语义对齐网页工作台的 lib/workbench/session-store.ts，但做了两层
 * 小程序化简化：
 *   1. 原生模型 thinking 在后端被策略性关闭（agent-driver-model 硬禁用），所以
 *      "思考过程"用伪思考条呈现：工具调用开始时按呈现规则表追加一行中文摘要，
 *      正文出现或 run 结束时收束。原生 thinking 块万一出现也照常支持。
 *   2. message_update 是"至今完整快照"语义：直接替换文本，不做增量拼接。
 *
 * 纯函数、无 wx 依赖，node --test 可直接单测。
 */

const TRACE_RING_MAX = 200
const RESULT_TEXT_LIMIT = 20000
const THINKING_LINE_RING_MAX = 60

/** 工具呈现规则表：折叠行人话摘要。与网页版 tool-presentation.ts 对应的小程序子集。 */
const TOOL_PRESENTATION = {
  web_search: (args) => `联网搜索「${clip(args && (args.query || args.q), 24) || '相关资料'}」`,
  fetch_url: (args) => `读取网页 ${clip(args && args.url, 32) || ''}`.trim(),
  create_stage: (args) => `创建课程${args && args.title ? `《${clip(args.title, 20)}》` : ''}`,
  create_folder: (args) => `创建目录${args && args.name ? `「${clip(args.name, 16)}」` : ''}`,
  rename_stage: (args) => `重命名课程${args && args.title ? `《${clip(args.title, 20)}》` : ''}`,
  move_to_folder: () => '整理课程归档',
  list_folder_stages: () => '查看课程列表',
  read_stage_outline: (args) => `阅读课程大纲${args && args.stageId ? '' : ''}`,
  read_stage: () => '阅读课程页面',
  patch_stage: () => '修改课程页面',
  grep_stage: (args) => `检索课程内容「${clip(args && args.pattern, 16) || ''}」`,
  generate_scene: (args) => `生成课程页面${typeof (args && args.order) === 'number' ? `（第 ${args.order} 页）` : ''}`,
  generate_actions: () => '生成页面互动',
  generate_image: (args) => `生成配图${args && args.prompt ? `：${clip(args.prompt, 16)}` : ''}`,
  generate_video: () => '生成课程视频',
  generate_tts: () => '生成讲解音频',
  start_course_generation: (args) => `提交课程生成${Array.isArray(args && args.pages) && args.pages.length ? `（共 ${args.pages.length} 页）` : ''}`,
  render_scene_preview: () => '渲染页面预览',
  duplicate_scene: () => '复制课程页面',
  list_scenes: () => '查看页面清单',
  set_roster: () => '配置讲解角色',
  list_voices: () => '试听可用音色',
  register_voice: () => '注册专属音色',
  clip_audio: () => '截取音频片段',
  extract_material: () => '解析学习资料',
  search_material: (args) => `检索素材库「${clip(args && args.query, 16) || ''}」`,
  read_material: () => '阅读素材',
  list_materials: () => '查看素材清单',
  wait_for_materials: () => '等待素材就绪',
  read_chat: () => '查阅历史对话',
  read_classroom: () => '查阅历史课程',
  search_chats: (args) => (clip(args && args.query, 16) ? `搜索历史对话「${clip(args.query, 16)}」` : '翻看历史对话'),
  search_classrooms: (args) => (clip(args && args.query, 16) ? `搜索历史课程「${clip(args.query, 16)}」` : '翻看已学课程'),
  read_skill: () => '加载技能手册',
  patch_skill: () => '调整技能手册',
  read: (args) => `加载技能「${clip(args && (args.path || args.name), 20) || ''}」`,
}

const TOOL_LABEL_FALLBACK = (name) => `调用 ${name}`

function clip(value, max) {
  const text = String(value === undefined || value === null ? '' : value).trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max)}…` : text
}

/** 工具卡折叠行文案；unknown 工具回落到原始名。 */
function presentToolLine(toolName, args) {
  const rule = TOOL_PRESENTATION[toolName]
  if (rule) {
    const line = rule(args && typeof args === 'object' ? args : {})
    if (line && line.trim()) return line.trim()
  }
  return TOOL_LABEL_FALLBACK(toolName)
}

function isAssistantMessage(message) {
  return Boolean(message) && message.role === 'assistant'
}

function assistantText(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('')
    .trim()
}

function assistantThinking(message) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .filter((block) => block && block.type === 'thinking')
    .map((block) => block.thinking || '')
    .join('')
    .trim()
}

function resultText(result) {
  const parts = result && Array.isArray(result.content) ? result.content : []
  const text = parts
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
  if (text.length <= RESULT_TEXT_LIMIT) {
    return { toolResultText: text, toolResultTruncated: false }
  }
  return { toolResultText: text.slice(0, RESULT_TEXT_LIMIT), toolResultTruncated: true }
}

function createInitialCourseAgentState() {
  return {
    nodes: [],
    status: 'idle',
    lastEventId: 0,
    question: null,
    sessionActive: false,
  }
}

function mapNode(state, key, mapper) {
  const index = state.nodes.findIndex((node) => node.key === key)
  if (index < 0) return state
  const nodes = state.nodes.slice()
  nodes[index] = mapper(nodes[index])
  return { ...state, nodes }
}

function appendNode(state, node) {
  return { ...state, nodes: state.nodes.concat([node]) }
}

/** 伪思考条：一次 run 只有一条，跨多个工具保持打开，正文/结束时收束。 */
function openThinking(state, event, firstLine) {
  const existing = state.nodes.find(
    (node) => node.kind === 'pseudo-thinking' && node.runId === event.runId,
  )
  if (existing) return state
  return appendNode(state, {
    key: `think-${event.id}`,
    kind: 'pseudo-thinking',
    runId: event.runId,
    lines: firstLine ? [firstLine] : [],
    streaming: true,
    startedAt: event.ts,
    endedAt: null,
  })
}

function appendThinkingLine(state, runAnchor, line) {
  if (!line) return state
  const target =
    state.nodes[
      state.nodes.length - 1] && state.nodes[state.nodes.length - 1].kind === 'pseudo-thinking'
      ? state.nodes.length - 1
      : state.nodes.findIndex(
          (node) => node.kind === 'pseudo-thinking' && node.runId === runAnchor,
        )
  if (target < 0) return state
  const nodes = state.nodes.slice()
  const lines = nodes[target].lines.concat([line]).slice(-THINKING_LINE_RING_MAX)
  nodes[target] = { ...nodes[target], lines }
  return { ...state, nodes }
}

function settleThinking(state, ts) {
  let changed = false
  const nodes = state.nodes.map((node) => {
    if (node.kind !== 'pseudo-thinking' || !node.streaming) return node
    changed = true
    return { ...node, streaming: false, endedAt: node.endedAt || ts }
  })
  return changed ? { ...state, nodes } : state
}

function runningToolIndex(nodes) {
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    if (nodes[i].kind === 'tool') {
      if (nodes[i].toolState === 'running') return i
      return -1
    }
  }
  return -1
}

function setQuestionAnswered(state) {
  if (!state.question) return state
  let changed = false
  const nodes = state.nodes.map((node) => {
    if (node.kind === 'question' && !node.answered) {
      changed = true
      return { ...node, answered: true }
    }
    return node
  })
  return changed ? { ...state, nodes, question: null } : { ...state, question: null }
}

/**
 * 折叠一个事件。event 形如 {id, ts, type, data}（SSE data JSON 解析结果）。
 * 返回新 state；纯函数，不修改入参。
 */
function foldCourseAgentEvent(state, event) {
  const next = { ...state, lastEventId: Math.max(state.lastEventId, Number(event.id) || 0) }
  const data = event.data && typeof event.data === 'object' ? event.data : {}
  const ts = event.ts

  switch (event.type) {
    case 'session_start':
    case 'session_resumed': {
      next.status = 'running'
      next.sessionActive = true
      return next
    }
    case 'user_message': {
      const settled = setQuestionAnswered(next)
      const text = String(data.text ?? '')
      // 本地乐观渲染的用户气泡由页面负责去重（pending 标记）；这里以服务端为准落一条。
      return appendNode(settled, {
        key: `user-${event.id}`,
        kind: 'user',
        text,
        pending: false,
      })
    }
    case 'trace': {
      const idx = runningToolIndex(next.nodes)
      if (idx < 0) return next
      const nodes = next.nodes.slice()
      const traces = (nodes[idx].toolTraces || []).concat([String(data.message ?? '')])
      nodes[idx] = {
        ...nodes[idx],
        toolTraces: traces.length > TRACE_RING_MAX ? traces.slice(-TRACE_RING_MAX) : traces,
      }
      return { ...next, nodes }
    }
    case 'thinking_end': {
      return settleThinking(next, ts)
    }
    case 'message_start': {
      if (!isAssistantMessage(data.message)) return next
      return openThinking(next, { ...event, runId: runAnchorOf(next) })
    }
    case 'message_update': {
      if (!isAssistantMessage(data.message)) return next
      const thinking = assistantThinking(data.message)
      const text = assistantText(data.message)
      if (!thinking && !text) return next
      let state2 = next
      if (thinking) {
        // 原生 thinking（后端目前关闭，但管线保留）：升级伪思考条为真文本。
        state2 = openThinking(state2, { ...event, runId: runAnchorOf(state2) })
        state2 = mapNode(state2, lastKeyOf(state2, 'pseudo-thinking'), (node) => ({
          ...node,
          nativeText: thinking,
        }))
      }
      if (text) {
        state2 = settleThinking(state2, ts)
        const key = lastKeyOf(state2, 'assistant')
        if (key) {
          state2 = mapNode(state2, key, (node) => ({ ...node, text, streaming: true }))
        } else {
          state2 = appendNode(state2, {
            key: `assistant-${event.id}`,
            kind: 'assistant',
            text,
            streaming: true,
          })
        }
      }
      return state2
    }
    case 'message_end': {
      if (!isAssistantMessage(data.message)) {
        // toolResult 消息是技能加载卡的完成凭证（无 tool_execution_end 的场景）。
        if (data.message && data.message.role === 'toolResult' && typeof data.message.toolCallId === 'string') {
          const callId = data.message.toolCallId
          let changed = false
          const nodes = next.nodes.map((node) => {
            if (node.kind === 'tool' && node.toolCallId === callId && node.toolState === 'running') {
              changed = true
              return { ...node, toolState: data.message.isError ? 'failed' : 'done', toolEndedAt: ts }
            }
            return node
          })
          if (changed) return { ...next, nodes }
        }
        return next
      }
      const text = assistantText(data.message)
      const thinking = assistantThinking(data.message)
      let state2 = settleThinking(next, ts)
      const key = lastKeyOf(state2, 'assistant')
      if (key) {
        if (text) state2 = mapNode(state2, key, (node) => ({ ...node, text, streaming: false }))
        else state2 = { ...state2, nodes: state2.nodes.filter((node) => node.key !== key) }
      } else if (text) {
        state2 = appendNode(state2, { key: `assistant-${event.id}`, kind: 'assistant', text })
      }
      if (thinking) {
        state2 = mapNode(state2, lastKeyOf(state2, 'pseudo-thinking'), (node) => ({
          ...node,
          nativeText: thinking,
          streaming: false,
          endedAt: node.endedAt || ts,
        }))
      }
      return state2
    }
    case 'tool_execution_start': {
      const toolName = String(data.toolName ?? 'tool')
      const args = data.args && typeof data.args === 'object' && !Array.isArray(data.args) ? data.args : {}
      const callId = String(data.toolCallId ?? '')
      const existingIndex = callId
        ? next.nodes.findIndex((node) => node.kind === 'tool' && node.toolCallId === callId)
        : -1
      let state2 = openThinking(next, { ...event, runId: runAnchorOf(next) })
      state2 = appendThinkingLine(state2, runAnchorOf(state2), presentToolLine(toolName, args))
      if (existingIndex >= 0) {
        const nodes = state2.nodes.slice()
        nodes[existingIndex] = { ...nodes[existingIndex], toolName, toolArgs: args }
        return { ...state2, nodes }
      }
      return appendNode(state2, {
        key: `tool-${event.id}`,
        kind: 'tool',
        toolCallId: callId,
        toolName,
        toolLabel: presentToolLine(toolName, args),
        toolArgs: args,
        toolState: 'running',
        toolTraces: [],
        toolStartedAt: ts,
      })
    }
    case 'tool_execution_end': {
      const callId = String(data.toolCallId ?? '')
      const result = data.result && typeof data.result === 'object' ? data.result : {}
      let changed = false
      const nodes = next.nodes.map((node) => {
        if (node.kind === 'tool' && node.toolCallId === callId) {
          changed = true
          return {
            ...node,
            toolState: data.isError ? 'failed' : 'done',
            toolDetails: result.details,
            toolEndedAt: ts,
            ...resultText(data.result),
          }
        }
        return node
      })
      return changed ? { ...next, nodes } : next
    }
    case 'user_question': {
      const question = String(data.question ?? '')
      if (!question) return next
      next.question = {
        question,
        options: Array.isArray(data.options) ? data.options : [],
        multiSelect: data.multiSelect === true,
      }
      return appendNode(next, {
        key: `question-${event.id}`,
        kind: 'question',
        ...next.question,
        answered: false,
      })
    }
    case 'stage_link':
    case 'course_link':
    case 'course_generation': {
      const stageId = String(data.stageId ?? '')
      const key = stageId ? `stage-${stageId}` : `stage-${event.id}`
      const existing = next.nodes.find((node) => node.key === key)
      if (existing) {
        return {
          ...next,
          nodes: next.nodes.map((node) => node === existing
            ? { ...node, title: String(data.title ?? node.title), generating: node.generating || event.type === 'course_generation' }
            : node),
        }
      }
      return appendNode(next, {
        key,
        kind: 'stage',
        stageId,
        title: String(data.title ?? '新课程'),
        url: String(data.url ?? ''),
        generating: event.type === 'course_generation',
      })
    }
    case 'session_interrupted': {
      next.status = 'running'
      return appendNode(next, {
        key: `notice-${event.id}`,
        kind: 'notice',
        text: '连接短暂中断，正在恢复任务…',
        tone: 'warn',
      })
    }
    case 'session_end': {
      next.sessionActive = false
      const status = String(data.status ?? 'succeeded')
      if (status === 'succeeded') next.status = 'succeeded'
      else if (status === 'cancelled') next.status = 'cancelled'
      else next.status = 'failed'
      let state2 = settleThinking(next, ts)
      const key = lastKeyOf(state2, 'assistant')
      if (key) state2 = mapNode(state2, key, (node) => ({ ...node, streaming: false }))
      if (status === 'failed') {
        state2 = appendNode(state2, {
          key: `notice-${event.id}`,
          kind: 'notice',
          text: '本次任务未完成，可以重试或换个说法再发一次。',
          tone: 'error',
        })
      }
      return state2
    }
    default:
      // library_changed / active_stage_changed / checkpoint / material_extraction /
      // consent_required / caught_up 等：不影响时间线（caught_up 由服务层处理）。
      return next
  }
}

/** 伪思考条与 run 的对应：以会话事件流顺序为锚（最近一次 user 消息之后的区间）。 */
function runAnchorOf(state) {
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    if (state.nodes[i].kind === 'user') return `after-${state.nodes[i].key}`
  }
  return 'session'
}

function lastKeyOf(state, kind) {
  for (let i = state.nodes.length - 1; i >= 0; i -= 1) {
    if (state.nodes[i].kind === kind) return state.nodes[i].key
  }
  return null
}

// ---------- 思考卡小字：一句话说清这一轮在想什么 ----------

const CONFIRM_ANSWER_PATTERN = /^确认方案|开始生成课程$/

/** 把用户的话压成一个短话题：去掉空白与收尾标点，过长截断。 */
function summarizeTopic(text, max = 14) {
  const source = String(text || '').replace(/\s+/g, ' ').trim().replace(/[。！？!?，,；;：:、~～\s]+$/u, '')
  if (!source) return ''
  const characters = Array.from(source)
  return characters.length > max ? `${characters.slice(0, max).join('')}…` : source
}

/**
 * 思考卡副标题。
 * context: { topic, answer }：topic 为用户本轮原话摘要；answer 为回答问题卡时的答案摘要。
 * phase: 'thinking'（思考中）| 'question'（本轮以提问结束）| 'course'（开始建课）| 'answer'（给出回复）| 'failed'
 */
function thinkingSummary(context, phase) {
  const topic = (context && context.topic) || ''
  const answer = (context && context.answer) || ''
  const confirmed = CONFIRM_ANSWER_PATTERN.test(answer)
  if (phase === 'failed') return '这次没有完成，可以重新发送试试'
  if (phase === 'thinking') {
    if (confirmed) return '正在按确认的方案准备课程'
    if (answer) return `正在分析你的回答「${answer}」`
    return topic ? `正在思考「${topic}」` : '正在梳理你的问题'
  }
  if (phase === 'course') {
    if (confirmed) return '按确认的方案开始生成课程'
    return topic ? `为「${topic}」安排课程` : '开始为你安排课程'
  }
  if (phase === 'question') {
    if (answer) return `根据你的回答「${answer}」，继续了解你的基础`
    return topic ? `围绕「${topic}」，先确认你的学习情况` : '先确认你的学习情况'
  }
  if (answer) return `根据你的回答「${answer}」整理好了回复`
  return topic ? `围绕「${topic}」整理好了回答` : '整理好了回答'
}

module.exports = {
  createInitialCourseAgentState,
  foldCourseAgentEvent,
  presentToolLine,
  summarizeTopic,
  thinkingSummary,
  TOOL_PRESENTATION,
}
