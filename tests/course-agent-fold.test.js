const assert = require('node:assert/strict')
const test = require('node:test')

const {
  createInitialCourseAgentState,
  foldCourseAgentEvent,
  presentToolLine,
} = require('../utils/course-agent-fold')

function apply(state, events) {
  return events.reduce((current, event) => foldCourseAgentEvent(current, event), state)
}

function ev(id, type, data, ts) {
  return { id, ts: ts || id * 1000, type, data }
}

test('presentToolLine renders human lines for known tools and falls back for unknown', () => {
  assert.equal(presentToolLine('web_search', { query: '分数加减' }), '联网搜索「分数加减」')
  assert.equal(presentToolLine('generate_scene', { order: 2 }), '生成课程页面（第 2 页）')
  assert.equal(presentToolLine('create_stage', { title: '分数加减' }), '创建课程《分数加减》')
  assert.equal(presentToolLine('mystery_tool', {}), '调用 mystery_tool')
})

test('a full successful run folds into user, thinking, tools, assistant nodes', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '做一节分数加减的课' }),
    ev(3, 'tool_execution_start', { toolCallId: 'c1', toolName: 'web_search', args: { query: '分数加减' } }),
    ev(4, 'tool_execution_end', {
      toolCallId: 'c1',
      isError: false,
      result: { content: [{ type: 'text', text: '8 条来源' }] },
    }),
    ev(5, 'tool_execution_start', { toolCallId: 'c2', toolName: 'generate_scene', args: { order: 1 } }),
    ev(6, 'trace', { message: '第 1 页内容生成完成' }),
    ev(7, 'tool_execution_end', {
      toolCallId: 'c2',
      isError: false,
      result: { content: [{ type: 'text', text: 'slide 已写入' }], details: { stageId: 'zl_1' } },
    }),
    ev(8, 'message_update', {
      message: { role: 'assistant', content: [{ type: 'text', text: '课程做好了，共 6 页。' }] },
    }),
    ev(9, 'message_end', {
      message: { role: 'assistant', content: [{ type: 'text', text: '课程做好了，共 6 页。' }] },
    }),
    ev(10, 'session_end', { status: 'succeeded' }),
  ])

  assert.equal(state.status, 'succeeded')
  assert.equal(state.sessionActive, false)
  assert.equal(state.lastEventId, 10)

  const kinds = state.nodes.map((node) => node.kind)
  assert.deepEqual(kinds, ['user', 'pseudo-thinking', 'tool', 'tool', 'assistant'])

  const thinking = state.nodes[1]
  assert.equal(thinking.streaming, false)
  // 正文首帧（message_update）即收束：伪思考条的结束以第一个可见产出为准
  assert.equal(thinking.endedAt, 8000)
  assert.deepEqual(thinking.lines, ['联网搜索「分数加减」', '生成课程页面（第 1 页）'])

  const search = state.nodes[2]
  assert.equal(search.toolState, 'done')
  assert.equal(search.toolResultText, '8 条来源')

  const scene = state.nodes[3]
  assert.equal(scene.toolState, 'done')
  assert.deepEqual(scene.toolTraces, ['第 1 页内容生成完成'])
  assert.equal(scene.toolDetails.stageId, 'zl_1')

  const answer = state.nodes[4]
  assert.equal(answer.streaming, false)
  assert.equal(answer.text, '课程做好了，共 6 页。')
})

test('message_update replaces text with full snapshots, never appends deltas', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: 'hi' }),
    ev(3, 'message_update', {
      message: { role: 'assistant', content: [{ type: 'text', text: '正在' }] },
    }),
    ev(4, 'message_update', {
      message: { role: 'assistant', content: [{ type: 'text', text: '正在安排课程' }] },
    }),
  ])
  const assistant = state.nodes.find((node) => node.kind === 'assistant')
  assert.equal(assistant.text, '正在安排课程')
  assert.equal(state.nodes.filter((node) => node.kind === 'assistant').length, 1)
})

test('user_question creates a card and pauses; the answer run reconciles it', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '做一节地理课' }),
    ev(3, 'tool_execution_start', { toolCallId: 'c1', toolName: 'create_stage', args: { title: '地形与气候' } }),
    ev(4, 'user_question', {
      question: '想用哪种练习形式？',
      options: [{ id: 'quiz', label: '随堂小测' }, { id: 'drag', label: '拖拽配对' }],
      multiSelect: false,
    }),
    ev(5, 'session_end', { status: 'succeeded' }),
  ])
  assert.ok(state.question)
  assert.equal(state.question.multiSelect, false)
  const card = state.nodes.find((node) => node.kind === 'question')
  assert.equal(card.answered, false)

  const answered = foldCourseAgentEvent(state, ev(6, 'user_message', { text: '随堂小测' }))
  assert.equal(answered.question, null)
  const settledCard = answered.nodes.find((node) => node.kind === 'question')
  assert.equal(settledCard.answered, true)
})

test('trace without a running tool folds to nothing', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'trace', { message: '杂散进度' }),
  ])
  assert.equal(state.nodes.length, 0)
})

test('stage_link lands a link card and survives the legacy course_link name', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'stage_link', { stageId: 'zl_9', title: '分数加减', url: 'https://example.test/zl_9' }),
    ev(3, 'course_link', { stageId: 'zl_8', title: '旧名字', url: 'https://example.test/zl_8' }),
  ])
  const cards = state.nodes.filter((node) => node.kind === 'stage')
  assert.equal(cards.length, 2)
  assert.equal(cards[0].title, '分数加减')
  assert.equal(cards[1].title, '旧名字')
})

test('failed run settles the thinking bar and surfaces a notice', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '做课' }),
    ev(3, 'tool_execution_start', { toolCallId: 'c1', toolName: 'web_search', args: { query: 'x' } }),
    ev(4, 'session_end', { status: 'failed' }),
  ])
  assert.equal(state.status, 'failed')
  const thinking = state.nodes.find((node) => node.kind === 'pseudo-thinking')
  assert.equal(thinking.streaming, false)
  const tool = state.nodes.find((node) => node.kind === 'tool')
  // run 提前结束：卡片停在 running 状态是诚实的（服务端没有发出结束帧）
  assert.equal(tool.toolState, 'running')
  const notice = state.nodes.filter((node) => node.kind === 'notice').pop()
  assert.equal(notice.tone, 'error')
})

test('tool errors mark the card failed and keep the error payload readable', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'tool_execution_start', { toolCallId: 'c1', toolName: 'generate_video', args: {} }),
    ev(3, 'tool_execution_end', {
      toolCallId: 'c1',
      isError: true,
      result: { content: [{ type: 'text', text: 'provider quota exceeded' }] },
    }),
  ])
  const tool = state.nodes.find((node) => node.kind === 'tool')
  assert.equal(tool.toolState, 'failed')
  assert.equal(tool.toolResultText, 'provider quota exceeded')
})

test('session_interrupted keeps the session resumable and folds a notice', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '做课' }),
    ev(3, 'session_interrupted', {}),
    ev(4, 'session_resumed', {}),
  ])
  assert.equal(state.status, 'running')
  assert.ok(state.nodes.some((node) => node.kind === 'notice' && node.tone === 'warn'))
})

test('a second run after the first opens a fresh thinking bar', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '第一问' }),
    ev(3, 'message_update', { message: { role: 'assistant', content: [{ type: 'text', text: '第一答' }] } }),
    ev(4, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: '第一答' }] } }),
    ev(5, 'session_end', { status: 'succeeded' }),
    ev(6, 'user_message', { text: '第二问' }),
    ev(7, 'session_start', {}),
    ev(8, 'tool_execution_start', { toolCallId: 'c1', toolName: 'web_search', args: { query: 'y' } }),
  ])
  // 第一轮没有工具调用也没有原生思考：不产生伪思考条（无可展示的过程）
  const bars = state.nodes.filter((node) => node.kind === 'pseudo-thinking')
  assert.equal(bars.length, 1)
  assert.equal(bars[0].streaming, true)
  assert.deepEqual(bars[0].lines, ['联网搜索「y」'])
})

test('replay from scratch reconstructs the same timeline (durable semantics)', () => {
  const events = [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: '重放' }),
    ev(3, 'tool_execution_start', { toolCallId: 'c1', toolName: 'read_stage_outline', args: {} }),
    ev(4, 'tool_execution_end', { toolCallId: 'c1', isError: false, result: { content: [{ type: 'text', text: 'ok' }] } }),
    ev(5, 'message_update', { message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] } }),
    ev(6, 'message_end', { message: { role: 'assistant', content: [{ type: 'text', text: '完成' }] } }),
    ev(7, 'session_end', { status: 'succeeded' }),
  ]
  const first = apply(createInitialCourseAgentState(), events)
  // 回放会丢中间 message_update（服务端压实），只剩最后一帧：结果必须一致
  const replayed = events.filter((event) => event.type !== 'message_update' || event.id === 5)
  const second = apply(createInitialCourseAgentState(), replayed)
  assert.deepEqual(
    second.nodes.map((node) => node.kind),
    first.nodes.map((node) => node.kind),
  )
  assert.equal(second.nodes.find((node) => node.kind === 'assistant').text, '完成')
})

test('native thinking blocks (currently disabled server-side) still render if they appear', () => {
  const state = apply(createInitialCourseAgentState(), [
    ev(1, 'session_start', {}),
    ev(2, 'user_message', { text: 'hi' }),
    ev(3, 'message_update', {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查资料，再定大纲' },
          { type: 'text', text: '' },
        ],
      },
    }),
    ev(4, 'thinking_end', {}),
    ev(5, 'message_end', {
      message: {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: '先查资料，再定大纲' },
          { type: 'text', text: '好的，我来安排。' },
        ],
      },
    }),
  ])
  const bar = state.nodes.find((node) => node.kind === 'pseudo-thinking')
  assert.equal(bar.nativeText, '先查资料，再定大纲')
  assert.equal(bar.streaming, false)
})
