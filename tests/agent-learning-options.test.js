const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/stub-ui-assets')

const {
  LEARNING_MODES,
  toggleLearningMode,
  optionsSignature,
  buildAgentMessageText,
  stripLearningAppendix
} = require('../utils/learning-options')
const { summarizeLearnerBaseline, masteryBucket } = require('../utils/learner-baseline')

test('learning modes are mutually exclusive and toggle off on second tap', () => {
  assert.deepEqual(LEARNING_MODES.map((mode) => mode.label), ['零基础学习', '制定学习计划', '深度交互学习'])
  assert.equal(toggleLearningMode('', 'zero-foundation'), 'zero-foundation')
  assert.equal(toggleLearningMode('zero-foundation', 'deep-interactive'), 'deep-interactive')
  assert.equal(toggleLearningMode('deep-interactive', 'deep-interactive'), '')
  assert.equal(toggleLearningMode('study-plan', 'unknown'), 'study-plan')
  assert.notEqual(optionsSignature({ universe: true, modeId: '' }), optionsSignature({ universe: false, modeId: '' }))
})

test('message text carries baseline + options appendix with skill handles at the end', () => {
  const baseline = { status: 'ready', learner: { gradeLabel: '高1' }, subjects: [{ name: '数学', weak: ['<script>'] }] }
  const text = buildAgentMessageText({
    text: '我想学函数的单调性',
    universe: true,
    modeId: 'zero-foundation',
    baseline,
    attachOptions: true,
    attachBaseline: true
  })
  assert.ok(text.startsWith('我想学函数的单调性\n'), '用户原话在最前，不被服务端冻结为会话技能')
  assert.match(text, /<zhilu-learner-context>\n\{.*\}\n<\/zhilu-learner-context>/)
  assert.ok(!text.includes('<script>'), '基本盘 JSON 里的尖括号被转义')
  assert.match(text, /【知鹿学习选项】参考我的宇宙：开 · 学习模式：零基础学习/)
  assert.ok(text.trim().endsWith('/learner-baseline-interview /zero-foundation'))
  assert.equal(stripLearningAppendix(text), '我想学函数的单调性')

  const json = text.split('\n').find((line) => line.startsWith('{'))
  assert.equal(JSON.parse(json).subjects[0].weak[0], '<script>')
})

test('universe off sends no baseline; answers without option change stay plain', () => {
  const off = buildAgentMessageText({ text: '讲讲勾股定理', universe: false, modeId: 'study-plan', baseline: null, attachOptions: true, attachBaseline: false })
  assert.ok(!off.includes('zhilu-learner-context'))
  assert.match(off, /参考我的宇宙：关 · 学习模式：制定学习计划/)
  assert.ok(off.endsWith('/learner-baseline-interview /curriculum-planner'))

  const failed = buildAgentMessageText({ text: '学分数', universe: true, modeId: '', baseline: null, attachOptions: true, attachBaseline: true })
  assert.match(failed, /"status":"unavailable"/)
  assert.ok(failed.endsWith('/learner-baseline-interview'))

  assert.equal(buildAgentMessageText({ text: ' (0, 1) ', universe: true, modeId: '', baseline: null, attachOptions: false, attachBaseline: false }), '(0, 1)')
  assert.equal(stripLearningAppendix('普通消息'), '普通消息')
})

test('learner baseline summary groups mastery per subject and infers subject tendency', () => {
  assert.equal(masteryBucket({ status: 'unknown', lastAssessmentScore: 1 }), 'mastered')
  assert.equal(masteryBucket({ status: 'unknown', lastAssessmentScore: 0 }), 'weak')
  assert.equal(masteryBucket({ status: 'assessed_stable' }), 'mastered')
  assert.equal(masteryBucket(null), 'untested')

  const topics = []
  const masteries = []
  ;['一次函数', '坐标系', '有理数', '代数式'].forEach((name, index) => {
    topics.push({ id: 10 + index, subject_id: 1, display_name: name })
    masteries.push({ knowledge_topic_id: 10 + index, status: index < 3 ? 'reinforce' : 'mastered' })
  })
  ;['电路', '力', '光', '热'].forEach((name, index) => {
    topics.push({ id: 20 + index, subject_id: 2, display_name: name })
    masteries.push({ knowledge_topic_id: 20 + index, status: 'mastered' })
  })
  topics.push({ id: 30, subject_id: 1, display_name: '二次函数' })
  const summary = summarizeLearnerBaseline(
    { current_grade: 10, semester: '上学期', textbook_version: '人教版', real_name: '不应出现', school_name: '不应出现' },
    {
      status: 'ready',
      subjects: [{ id: 1, display_name: '数学', display_order: 1 }, { id: 2, display_name: '物理', display_order: 2 }, { id: 3, display_name: '化学', display_order: 3 }],
      topics,
      masteries,
      universe: { evidenceCount: 8 }
    }
  )
  assert.equal(summary.status, 'ready')
  assert.equal(summary.learner.gradeLabel, '高1')
  assert.equal(summary.subjects.length, 2, '没有知识点的学科不带')
  const math = summary.subjects[0]
  assert.deepEqual(math.weak, ['一次函数', '坐标系', '有理数'])
  assert.deepEqual(math.mastered, ['代数式'])
  assert.equal(math.untestedCount, 1)
  assert.equal(math.masteryRate, 0.25)
  assert.deepEqual(summary.weakSubjects, ['数学'])
  assert.deepEqual(summary.strongSubjects, ['物理'])
  assert.ok(!JSON.stringify(summary).includes('不应出现'), '不外发姓名与学校')

  const profileOnly = summarizeLearnerBaseline({ current_grade: 8 }, { status: 'semester_required' })
  assert.equal(profileOnly.status, 'profile_only')
  assert.equal(profileOnly.learner.gradeLabel, '初2')
})

// ---------- 页面：选项附录 + 摸底问答续用同一会话 + 确认按钮 ----------

const pagePath = require.resolve('../pages/agent-chat/index.js')

function loadPage(requests) {
  delete require.cache[pagePath]
  let definition = null
  const storage = { zion_runtime_token: 'zion-jwt', 'course-agent-access-token': 'access' }
  global.Page = (page) => { definition = page }
  global.wx = {
    getWindowInfo() {
      return { windowWidth: 375, windowHeight: 667, statusBarHeight: 20, screenHeight: 667, safeArea: { bottom: 667 } }
    },
    getMenuButtonBoundingClientRect() {
      return { left: 276, top: 26, width: 87, height: 32 }
    },
    getStorageSync(key) { return storage[key] || '' },
    setStorageSync(key, value) { storage[key] = value },
    removeStorageSync(key) { delete storage[key] },
    showToast() {},
    setClipboardData() {},
    request(options) {
      requests.push(options)
      if (options.method === 'POST' && /\/api\/agent\/sessions$/.test(options.url)) {
        options.success({ statusCode: 202, data: { id: 'session-1', status: 'queued' }, header: {} })
      } else if (options.method === 'POST' && /\/messages$/.test(options.url)) {
        options.success({ statusCode: 202, data: { id: 'session-1' }, header: {} })
      }
      return { abort() {} }
    },
    nextTick(callback) { callback() },
    hideKeyboard() {}
  }
  global.getApp = () => ({ globalData: {} })
  require(pagePath)
  return definition
}

function instantiate(definition) {
  const page = Object.create(definition)
  page.data = JSON.parse(JSON.stringify(definition.data))
  page.setData = (patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      if (!key.includes('.')) { page.data[key] = value; return }
      const path = key.split('.')
      let target = page.data
      path.slice(0, -1).forEach((part) => { target = target[part] = target[part] || {} })
      target[path[path.length - 1]] = value
    })
  }
  return page
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const posts = (requests) => requests.filter((request) => request.method === 'POST')

test('agent-chat attaches baseline once and keeps answering ask_user in the same session', async () => {
  const requests = []
  const page = instantiate(loadPage(requests))
  page.onLoad({ universe: '1', mode: 'deep-interactive' })
  page._isPageVisible = true
  assert.equal(page.data.includeUniverse, true)
  assert.equal(page.data.activeLearningMode, 'deep-interactive')
  let baselineLoads = 0
  page.loadBaselineForAgent = () => { baselineLoads += 1; return Promise.resolve({ status: 'ready', learner: { gradeLabel: '高1' }, subjects: [] }) }

  page.sendMessage('我想学函数单调性')
  await sleep(400)
  const [create] = posts(requests)
  assert.match(create.url, /\/api\/agent\/sessions$/)
  assert.match(create.data.prompt, /<zhilu-learner-context>/)
  assert.ok(create.data.prompt.endsWith('/learner-baseline-interview /deep-interactive'))
  assert.equal(page.data.messages.find((message) => message.role === 'user').text, '我想学函数单调性', '气泡只显示用户原话')

  // 服务端回放用户消息（带附录）不应重复插入气泡
  page.handleAgentEvent({ id: 1, type: 'user_message', data: { text: create.data.prompt } })
  assert.equal(page.data.messages.filter((message) => message.role === 'user').length, 1)

  // 摸底提问：ask_user 结束本轮 run
  page.handleAgentEvent({ id: 2, type: 'user_question', data: { question: 'y = 2x + 1 经过哪个点？', options: [{ id: 'a', label: '(0, 1)' }, { id: 'b', label: '不会 / 没学过' }] } })
  page.handleAgentEvent({ id: 3, type: 'session_end', data: { status: 'succeeded' } })
  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'a' } } })
  page.handleQuestionConfirm({})
  await sleep(400)
  const answer = posts(requests)[1]
  assert.match(answer.url, /\/api\/agent\/sessions\/session-1\/messages$/, '回答续发到同一会话，不新建会话')
  assert.equal(answer.data.text, '(0, 1)', '选项未变时回答不重复附带基本盘')
  page.handleAgentEvent({ id: 3.5, type: 'user_message', data: { text: answer.data.text } })

  // 方案确认卡：confirm_generate 渲染为主按钮
  page.handleAgentEvent({ id: 4, type: 'user_question', data: { question: '方案确认后开始生成课程，可以吗？', options: [{ id: 'confirm_generate', label: '确认方案，开始生成课程' }, { id: 'adjust_plan', label: '我想调整方案' }] } })
  const card = page.data.messages.find((message) => message.kind === 'question' && !message.answered)
  assert.equal(card.options[0].isConfirm, true)
  assert.equal(card.options[1].isConfirm, false)
  page.handleAgentEvent({ id: 5, type: 'session_end', data: { status: 'succeeded' } })

  // 中途切换模式：只附带选项行，不再重发基本盘
  page.handleLearningModeTap({ currentTarget: { dataset: { id: 'zero-foundation' } } })
  page.handleQuestionOptionTap({ currentTarget: { dataset: { id: 'confirm_generate' } } })
  page.handleQuestionConfirm({})
  await sleep(400)
  const confirm = posts(requests)[2]
  assert.match(confirm.url, /session-1\/messages$/)
  assert.ok(confirm.data.text.startsWith('确认方案，开始生成课程'))
  assert.ok(!confirm.data.text.includes('zhilu-learner-context'))
  assert.ok(confirm.data.text.endsWith('/learner-baseline-interview /zero-foundation'))
  assert.equal(baselineLoads, 1)

  // 新对话：重新建会话并重新附带基本盘
  page.handleNewConversation()
  page.sendMessage('再来一节分数课')
  await sleep(400)
  const second = posts(requests).filter((request) => /\/api\/agent\/sessions$/.test(request.url))[1]
  assert.match(second.url, /\/api\/agent\/sessions$/)
  assert.match(second.data.prompt, /<zhilu-learner-context>/)
  page.onUnload()
})
