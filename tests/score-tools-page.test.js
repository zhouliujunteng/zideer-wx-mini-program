const assert = require('node:assert/strict')
const test = require('node:test')
require('./helpers/stub-ui-assets')

// 首页 AI 提分工具（../docs/AI提分工具适配方案.md）：拍题 → 识题 → 确认 → 分析 → 结果；
// 收费（用户 10-08）：每个工具每天免费 3 次，超出后会员确认扣积分，非会员当天不能再用。

const toolPagePath = require.resolve('../score-tools/tool/index.js')
const historyPagePath = require.resolve('../score-tools/history/index.js')
const servicePath = require.resolve('../services/score-tools.js')
const identityPath = require.resolve('../services/identity.js')
const { decorateRunResult } = require('../utils/score-tool-view')

const Q = 'a'.repeat(32)
const U = 'b'.repeat(32)
const R = 'c'.repeat(32)
const STEM = '一辆汽车从静止开始做匀加速直线运动。求前 3 s 内至少行驶多少米。'

const QUOTA = { success: true, freeDaily: 3, price: 50, tools: [{ id: 'question-review', label: '审题拆解', live: true, usedToday: 1, freeRemaining: 2 }, { id: 'error-diagnosis', label: '错因诊断', live: true, usedToday: 3, freeRemaining: 0 }] }

const REVIEW_VIEW = {
  status: 'ready',
  message: '',
  categories: [
    { key: 'task', label: '任务词', hint: '题目要你完成的动作与目标' },
    { key: 'implicit', label: '隐藏条件', hint: '原文没明说、但能推出来的条件' }
  ],
  questions: [{
    label: '第1题', text: STEM, type: '计算题', warnings: ['「至少」是下界'], restatement: '求前 3 s 至少走多远。',
    sections: [
      { key: 'task', items: [{ quote: '求前 3 s 内至少行驶多少米', interpretation: '你要算路程' }], emptyReason: '' },
      { key: 'implicit', items: [{ quote: '从静止开始', interpretation: '初速度为零' }], emptyReason: '' }
    ],
    segments: [{ text: '一辆汽车', key: '' }, { text: '从静止开始', key: 'implicit' }, { text: '做匀加速直线运动。', key: '' }, { text: '求前 3 s 内至少行驶多少米', key: 'task' }, { text: '。', key: '' }]
  }]
}

const DIAGNOSIS_VIEW = {
  status: 'diagnosed', message: '', summary: '位移公式少了 ½。', causeType: 'knowledge', causeLabel: '知识没掌握',
  stepLabels: { read: '读题', method: '选方法', compute: '列式计算', answer: '最终答案' },
  steps: [{ key: 'read', status: 'ok', note: '' }, { key: 'method', status: 'ok', note: '' }, { key: 'compute', status: 'error', note: '公式错' }, { key: 'answer', status: 'affected', note: '' }],
  firstError: { step: 'compute', quote: 'x = at²', explanation: '应为 ½at²' },
  chain: ['18 m 错'], compare: { student: '算错了', ai: '公式记错', agree: false }, fixes: ['重新默写公式'], knowledgePoints: ['匀变速位移']
}

function question(status, extra = {}) {
  return { id: Q, status, failure: '', message: '', subject: '物理', questions: status === 'ready' ? [{ label: '第1题', stem: STEM, studentAnswer: 'x = at² = 18 m', teacherMarks: '', hasFigure: false }] : [], selectedIndex: 0, stem: STEM, studentAnswer: 'x = at² = 18 m', hasFigure: false, confirmed: false, createdAt: '2026-10-08T02:00:00Z', ...extra }
}

function run(status, extra = {}) {
  return { id: R, tool: 'question-review', toolLabel: '审题拆解', questionId: Q, question: { stem: STEM, studentAnswer: '' }, status, failure: status === 'failed' ? 'output' : '', billing: 'free', credits: 0, chargeStatus: 'none', result: status === 'succeeded' ? REVIEW_VIEW : null, createdAt: new Date().toISOString(), ...extra }
}

/** 加载页面：services/score-tools 用真的，课程服务请求换成脚本化的假实现 server(path, options) → { statusCode, data }。 */
function load(pagePath, server, { modalConfirm = true } = {}) {
  delete require.cache[pagePath]
  delete require.cache[servicePath]
  const requests = []
  require.cache[identityPath] = {
    id: identityPath, filename: identityPath, loaded: true,
    exports: {
      requestCourseApi: async (url, options = {}) => {
        requests.push({ url, method: options.method || 'GET', data: options.data })
        return server(url, options)
      },
      requestCourseUpload: async (url, options) => {
        requests.push({ url, method: 'UPLOAD', bytes: options.bytes.byteLength, contentType: options.contentType })
        return { statusCode: 201, data: { success: true, uploadId: U } }
      }
    }
  }
  const calls = { toast: [], modal: [], navigate: [], redirect: [] }
  let definition = null
  global.Page = (page) => { definition = page }
  global.getCurrentPages = () => [{}, {}]
  global.wx = {
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
    setNavigationBarTitle() {},
    showToast: (opts) => calls.toast.push(opts.title),
    showModal: (opts) => { calls.modal.push(opts); if (opts.success) opts.success({ confirm: modalConfirm }) },
    navigateBack: () => calls.navigate.push('back'),
    navigateTo: (opts) => calls.navigate.push(opts.url),
    redirectTo: (opts) => calls.redirect.push(opts.url),
    switchTab: (opts) => calls.navigate.push(opts.url),
    chooseMedia: (opts) => opts.success({ tempFiles: [{ tempFilePath: 'wxfile://tmp/q1.jpg' }] }),
    previewImage() {},
    getFileSystemManager: () => ({ readFile: (opts) => opts.success({ data: new ArrayBuffer(2048) }) })
  }
  require(pagePath)
  delete require.cache[identityPath]
  const page = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      for (const [key, value] of Object.entries(values)) {
        const parts = key.split('.')
        let target = this.data
        while (parts.length > 1) target = target[parts.shift()]
        target[parts[0]] = value
      }
    }
  }
  for (const [key, value] of Object.entries(definition)) if (typeof value === 'function') page[key] = value
  return { page, requests, calls }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

test('审题拆解 goes photo → recognition → confirm → analysis → highlighted result', async () => {
  let questionState = question('recognizing')
  let runState = run('queued')
  const { page, requests } = load(toolPagePath, (url, { method = 'GET', data }) => {
    if (url === '/api/learn/score-tools') return { statusCode: 200, data: QUOTA }
    if (url === '/api/learn/score-tools/questions' && method === 'POST') return { statusCode: 201, data: { success: true, question: questionState } }
    if (url === `/api/learn/score-tools/questions?id=${Q}`) return { statusCode: 200, data: { success: true, question: questionState } }
    if (url === '/api/learn/score-tools/questions' && method === 'PATCH') return { statusCode: 200, data: { success: true, question: { ...questionState, stem: data.stem, confirmed: true } } }
    if (url === '/api/learn/score-tools/runs' && method === 'POST') return { statusCode: 201, data: { success: true, run: runState } }
    if (url === `/api/learn/score-tools/runs?id=${R}`) return { statusCode: 200, data: { success: true, run: runState } }
    throw new Error(`unexpected ${method} ${url}`)
  })
  page.onLoad({ tool: 'question-review' })
  page.onShow()
  await settle()
  assert.equal(page.data.page.title, '审题拆解')
  assert.deepEqual(page.data.quota, { freeRemaining: 2, freeDaily: 3, price: 50 })
  assert.equal(page.data.step, 'capture')

  page.choosePhotos()
  assert.equal(page.data.photos.length, 1)
  await page.recognize()
  assert.equal(page.data.step, 'recognizing')
  assert.deepEqual(requests.find((r) => r.method === 'UPLOAD'), { url: '/api/learn/score-tools/uploads', method: 'UPLOAD', bytes: 2048, contentType: 'image/jpeg' })
  assert.deepEqual(requests.find((r) => r.method === 'POST').data, { uploadIds: [U] })

  questionState = question('ready')
  await page.tick()
  assert.equal(page.data.step, 'confirm')
  assert.equal(page.data.stem, STEM)

  page.handleStemInput({ detail: { value: `${STEM}（改过）` } })
  page.handleExtraInput({ currentTarget: { dataset: { key: 'note' } }, detail: { value: '第二章' } })
  await page.submitRun({ type: 'tap' })
  assert.equal(page.data.step, 'running')
  const patch = requests.find((r) => r.method === 'PATCH')
  assert.equal(patch.data.stem, `${STEM}（改过）`)
  const started = requests.filter((r) => r.url === '/api/learn/score-tools/runs' && r.method === 'POST')
  assert.deepEqual(started[0].data, { tool: 'question-review', questionId: Q, input: { note: '第二章' }, acceptCharge: false })

  runState = run('succeeded')
  await page.tick()
  assert.equal(page.data.step, 'result')
  assert.equal(page.data.view.kind, 'review')
  assert.deepEqual(page.data.view.questions[0].segments.filter((s) => s.key).map((s) => s.key), ['implicit', 'task'])
  assert.equal(page.data.view.questions[0].sections[0].number, '01')
  page.onUnload()
})

test('after the free uses a member confirms the 50-credit charge before the analysis starts', async () => {
  const posted = []
  const { page, calls } = load(toolPagePath, (url, { method = 'GET', data }) => {
    if (url === '/api/learn/score-tools') return { statusCode: 200, data: QUOTA }
    if (url === '/api/learn/score-tools/questions' && method === 'PATCH') return { statusCode: 200, data: { success: true, question: question('ready', { confirmed: true }) } }
    if (url === '/api/learn/score-tools/runs' && method === 'POST') {
      posted.push(data.acceptCharge)
      if (!data.acceptCharge) return { statusCode: 402, data: { code: 'CHARGE_CONFIRM_REQUIRED', price: 50 } }
      return { statusCode: 201, data: { success: true, run: run('queued', { tool: 'error-diagnosis', billing: 'credits', credits: 50 }) } }
    }
    if (url.startsWith('/api/learn/score-tools/runs?id=')) return { statusCode: 200, data: { success: true, run: run('queued') } }
    throw new Error(`unexpected ${method} ${url}`)
  })
  page.onLoad({ tool: 'error-diagnosis' })
  page.applyQuestion(question('ready'))
  await page.submitRun({ type: 'tap' })
  await settle()
  assert.deepEqual(posted, [false, true])
  assert.equal(calls.modal[0].title, '今天的免费次数用完了')
  assert.match(calls.modal[0].content, /50 积分/)
  assert.equal(page.data.step, 'running')
  page.onUnload()
})

test('a non-member who used the 3 free uses is told to come back tomorrow, and nothing is charged', async () => {
  const { page, calls } = load(toolPagePath, (url, { method = 'GET' }) => {
    if (url === '/api/learn/score-tools') return { statusCode: 200, data: QUOTA }
    if (method === 'PATCH') return { statusCode: 200, data: { success: true, question: question('ready', { confirmed: true }) } }
    if (method === 'POST') return { statusCode: 429, data: { code: 'DAILY_LIMIT', member: false } }
    throw new Error(`unexpected ${method} ${url}`)
  }, { modalConfirm: true })
  page.onLoad({ tool: 'question-review' })
  page.applyQuestion(question('ready'))
  await page.submitRun({ type: 'tap' })
  assert.equal(calls.modal.length, 1)
  assert.match(calls.modal[0].content, /明天再来/)
  assert.equal(calls.modal[0].showCancel, false)
  assert.equal(page.data.step, 'confirm')
})

test('错因诊断 will not start without the student answer', async () => {
  const { page, requests, calls } = load(toolPagePath, () => ({ statusCode: 200, data: QUOTA }))
  page.onLoad({ tool: 'error-diagnosis' })
  page.applyQuestion(question('ready'))
  page.handleAnswerInput({ detail: { value: '   ' } })
  await page.submitRun({ type: 'tap' })
  assert.deepEqual(calls.toast, ['请把你的作答也填上'])
  assert.equal(requests.filter((r) => r.method !== 'GET').length, 0)
})

test('an unreadable photo goes back to capture with the reason', async () => {
  const { page } = load(toolPagePath, (url) => {
    if (url === `/api/learn/score-tools/questions?id=${Q}`) return { statusCode: 200, data: { success: true, question: question('failed', { failure: 'unclear', message: '照片太暗' }) } }
    return { statusCode: 200, data: QUOTA }
  })
  page.onLoad({ tool: 'question-review' })
  await page.pollQuestion(Q)
  assert.equal(page.data.step, 'capture')
  assert.equal(page.data.question.failureText, '照片太暗')
})

test('opening a record by runId shows its result and offers the other tool for the same question', async () => {
  const { page, calls } = load(toolPagePath, (url) => {
    if (url === `/api/learn/score-tools/runs?id=${R}`) return { statusCode: 200, data: { success: true, run: run('succeeded') } }
    return { statusCode: 200, data: QUOTA }
  })
  await page.onLoad({ runId: R })
  assert.equal(page.data.step, 'result')
  assert.equal(page.data.tool, 'question-review')
  page.switchTool({ currentTarget: { dataset: { tool: 'error-diagnosis' } } })
  assert.deepEqual(calls.redirect, [`/score-tools/tool/index?tool=error-diagnosis&questionId=${Q}`])
})

test('the diagnosis result is shaped for the page', () => {
  const view = decorateRunResult({ tool: 'error-diagnosis', result: DIAGNOSIS_VIEW })
  assert.equal(view.kind, 'diagnosis')
  assert.equal(view.causeLabel, '知识没掌握')
  assert.deepEqual(view.steps.map((s) => [s.label, s.statusText]), [['读题', '没问题'], ['选方法', '没问题'], ['列式计算', '出错'], ['最终答案', '受影响']])
  assert.deepEqual(view.firstError, { stepLabel: '列式计算', quote: 'x = at²', explanation: '应为 ½at²', correction: '' })
  assert.equal(view.compare.agree, 'no')
  // 第一版的旧记录：fixes 是字符串数组、没有 causes / reference
  assert.deepEqual(view.fixes, [{ kind: 'method', kindLabel: '', text: '重新默写公式' }])
  assert.deepEqual(view.causes, [])
  assert.equal(view.reference, null)
  assert.equal(decorateRunResult({ tool: 'paper-analysis', result: {} }), null)
})

test('the second-version diagnosis shows ranked causes, the corrected step, layered fixes and the reference', () => {
  const view = decorateRunResult({
    tool: 'error-diagnosis',
    result: {
      ...DIAGNOSIS_VIEW,
      firstError: { step: 'compute', quote: 'x = at²', explanation: '应为 ½at²', correction: 'x = ½at² = 9 m' },
      causes: [{ type: 'knowledge', likelihood: 'high', evidence: '少了 ½', label: '知识没掌握', likelihoodLabel: '可能性高' }],
      fixes: [{ kind: 'practice', kindLabel: '补救练习', text: '做 5 道位移题' }, { kind: 'method', kindLabel: '方法', text: '代 t=1 检查' }],
      selfCheck: ['t = 0 时成立吗？'],
      reference: { finalAnswer: '9 m', steps: ['x = ½at²', '= 9 m'], uncertain: true, uncertainNote: '图里 3 的含义' }
    }
  })
  assert.equal(view.firstError.correction, 'x = ½at² = 9 m')
  assert.deepEqual(view.causes.map((c) => [c.label, c.likelihood, c.likelihoodLabel]), [['知识没掌握', 'high', '可能性高']])
  assert.deepEqual(view.fixes.map((f) => f.kindLabel), ['补救练习', '方法'])
  assert.deepEqual(view.selfCheck, ['t = 0 时成立吗？'])
  assert.deepEqual(view.reference, { finalAnswer: '9 m', steps: ['x = ½at²', '= 9 m'], uncertainNote: '图里 3 的含义' })
})

const PRACTICE_VIEW = {
  total: 2,
  answeredCount: 1,
  correctCount: 0,
  questions: [
    { index: 0, level: 'basic', levelLabel: '基础巩固', type: 'fill', stem: '求位移', options: [], design: '换个数', point: '位移', answered: false, yourAnswer: '', correct: null, answer: '', explanation: '' },
    { index: 1, level: 'trap', levelLabel: '易错辨析', type: 'choice', stem: '选位移\n（单位 m）', options: [{ letter: 'A', text: '8' }, { letter: 'B', text: '16' }], design: '', point: '', answered: true, yourAnswer: 'A', correct: false, answer: 'B', explanation: '½×2×16 = 16' }
  ]
}

test('举一反三 practice: pick, submit to the server, then the answer and explanation appear', async () => {
  let practice = PRACTICE_VIEW
  const { page, requests } = load(toolPagePath, (url, { method = 'GET', data }) => {
    if (url === '/api/learn/score-tools') return { statusCode: 200, data: QUOTA }
    if (url === `/api/learn/score-tools/runs?id=${R}`) return { statusCode: 200, data: { success: true, run: run('succeeded', { tool: 'error-variation', toolLabel: '举一反三', result: practice }) } }
    if (url === '/api/learn/score-tools/runs' && method === 'PATCH') {
      practice = { ...PRACTICE_VIEW, answeredCount: 2, correctCount: 1, questions: [{ ...PRACTICE_VIEW.questions[0], answered: true, yourAnswer: data.answer, correct: true, answer: '8', explanation: '½×4×4' }, PRACTICE_VIEW.questions[1]] }
      return { statusCode: 200, data: { success: true, run: run('succeeded', { tool: 'error-variation', result: practice }) } }
    }
    throw new Error(`unexpected ${method} ${url}`)
  })
  page.onLoad({ runId: R })
  await settle()
  const view = page.data.view
  assert.equal(view.kind, 'practice')
  assert.equal(view.finished, false)
  assert.deepEqual(view.questions[1].options.map((o) => o.state), ['wrong', 'right'])
  assert.deepEqual(view.questions[1].stemLines, ['选位移', '（单位 m）'])
  // 答过的选择题不能再改
  page.pickOption({ currentTarget: { dataset: { index: 1, letter: 'B' } } })
  assert.equal(page.data.practiceDraft[1], undefined)
  await page.submitPractice({ currentTarget: { dataset: { index: 0 } } })
  assert.equal(requests.filter((r) => r.method === 'PATCH').length, 0) // 没填不交
  page.handleFillInput({ currentTarget: { dataset: { index: 0 } }, detail: { value: '8' } })
  await page.submitPractice({ currentTarget: { dataset: { index: 0 } } })
  assert.deepEqual(requests.find((r) => r.method === 'PATCH').data, { id: R, index: 0, answer: '8' })
  assert.equal(page.data.view.finished, true)
  assert.equal(page.data.view.correctCount, 1)
  assert.equal(page.data.view.questions[0].explanation, '½×4×4')
})

test('错因诊断 hands its result to 举一反三 through fromRunId', async () => {
  const { page, calls, requests } = load(toolPagePath, (url, { method = 'GET' }) => {
    if (url === '/api/learn/score-tools') return { statusCode: 200, data: QUOTA }
    if (url === `/api/learn/score-tools/questions?id=${Q}`) return { statusCode: 200, data: { success: true, question: question('ready', { confirmed: true }) } }
    if (url === '/api/learn/score-tools/questions' && method === 'PATCH') return { statusCode: 200, data: { success: true, question: question('ready', { confirmed: true }) } }
    if (url === '/api/learn/score-tools/runs' && method === 'POST') return { statusCode: 201, data: { success: true, run: run('queued', { tool: 'error-variation' }) } }
    throw new Error(`unexpected ${method} ${url}`)
  })
  page.data.run = run('succeeded', { tool: 'error-diagnosis' })
  page.switchTool({ currentTarget: { dataset: { tool: 'error-variation', relay: '1' } } })
  assert.equal(calls.redirect[0], `/score-tools/tool/index?tool=error-variation&questionId=${Q}&fromRunId=${R}`)
  page.data.run = null
  page.onLoad({ tool: 'error-variation', questionId: Q, fromRunId: R })
  await settle()
  assert.equal(page.data.step, 'confirm')
  await page.submitRun()
  page.onUnload() // 停掉轮询
  assert.deepEqual(requests.find((r) => r.method === 'POST').data.input, { focus: '', fromRunId: R })
})

test('the history lists records with their tool and charge, and deletes one after confirming', async () => {
  const runs = [run('succeeded', { billing: 'credits', credits: 50 }), run('failed', { id: 'd'.repeat(32), tool: 'error-diagnosis', toolLabel: '错因诊断' })]
  const { page, requests } = load(historyPagePath, (url, { method = 'GET' }) => {
    if (method === 'DELETE') return { statusCode: 200, data: { success: true } }
    return { statusCode: 200, data: { success: true, runs } }
  })
  page.onLoad()
  await page.load()
  assert.equal(page.data.loadState, 'ready')
  assert.deepEqual(page.data.runs.map((r) => [r.toolLabel, r.statusText, r.creditsText]), [['审题拆解', '', '50 积分'], ['错因诊断', '没分析好', '']])
  page.askDelete({ currentTarget: { dataset: { id: R } } })
  await settle()
  assert.ok(requests.some((r) => r.method === 'DELETE' && r.url === `/api/learn/score-tools/runs?id=${R}`))
  assert.equal(page.data.runs.length, 1)
})

test('the highlighted stem is split into lines so no colored piece spans a line break', () => {
  const { stemLines } = require('../utils/score-tool-view')
  const lines = stemLines([{ text: '甲', key: '' }, { text: '乙。\n(1) 丙', key: 'task' }, { text: '\n\n丁', key: '' }])
  assert.deepEqual(lines.map((line) => line.parts.map((p) => `${p.key}:${p.text}`)), [[':甲', 'task:乙。'], ['task:(1) 丙'], [], [':丁']])
})
