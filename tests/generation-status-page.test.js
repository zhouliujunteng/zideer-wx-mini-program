const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')

function setup(overrides = {}) {
  let definition
  const timers = new Map(), navigations = [], notices = []
  let timerId = 0
  const service = {
    loadCurrentLearningPlans: async () => plans('queued'),
    createCurrentCourseGenerationQuote: async () => ({}),
    confirmCurrentCourseGeneration: async () => ({}),
    prepareCourseOutlineReview: async () => ({ prepared: true }),
    loadCourseOutline: async () => ({ reviewRequired: false }),
    ...overrides
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/generation-status/index.js'), 'utf8'), {
    Page(value) { definition = value }, require(name) {
      if (name === '../../utils/course-state') return require('../utils/course-state')
      return Object.fromEntries(Object.keys(service).map((key) => [key, (...args) => service[key](...args)]))
    },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId }, clearTimeout(id) { timers.delete(id) },
    wx: { showToast(value) { notices.push(value.title) }, redirectTo(value) { navigations.push(value.url) }, navigateTo(value) { navigations.push(value.url) },
      navigateBack(value) { value.fail() }, switchTab(value) { navigations.push(value.url) } }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ planItemId: '11', courseInstanceId: '21' })
  return { page, timers, service, navigations, notices }
}
function plans(status, content = 'lesson') {
  return { plans: [{ items: [{ id: '11', status: 'available', topicName: 'Linear equations',
    courseInstances: status ? [{ id: '21', status, contentVersionRef: content }] : [] }] }] }
}

test('a paused plan never leaves an old pending course polling or offers a new charge', async () => {
  const data = plans('queued', '')
  data.plans[0].status = 'paused'
  const { page, timers } = setup({ loadCurrentLearningPlans: async () => data })
  await page.onShow()
  assert.equal(page.data.result.canPoll, false)
  assert.equal(page.data.result.canStartGeneration, false)
  assert.match(page.data.result.title, /暂停/)
  assert.equal(timers.size, 0)
})

test('a released voided course can get a new quote without creating a new plan', async () => {
  const data = plans('voided_credit_limit', '')
  const course = data.plans[0].items[0].courseInstances[0]
  course.creditSettlement = { status: 'released', voidedCredits: 10 }
  course.generationJob = { status: 'limit_exceeded_cancelled' }
  const { page } = setup({ loadCurrentLearningPlans: async () => data,
    createCurrentCourseGenerationQuote: async () => ({ quoteId: '50', estimatedLowerCredits: 8, estimatedUpperCredits: 2000, frozenTargetCredits: 2000 }) })
  await page.onShow()
  assert.equal(page.data.result.canStartGeneration, true)
  assert.equal(page.data.result.canRetryGeneration, true)
  await page.requestQuote()
  await page.loadPage()
  assert.equal(page.data.quote.quoteId, '50')
})

test('a historical failed-course link follows the newer attempt instead of offering another retry', async () => {
  const data = plans('voided_credit_limit', '')
  data.plans[0].items[0].courseInstances.unshift({ id: '22', status: 'queued', generationJob: { status: 'queued' } })
  const { page } = setup({ loadCurrentLearningPlans: async () => data })
  await page.onShow()
  assert.equal(page.data.result.courseInstanceId, '22')
  assert.equal(page.data.result.canStartGeneration, false)
  assert.equal(page.data.result.canPoll, true)
  page.onHide()
})

test('the course secondary page no longer exposes plan creation exits', () => {
  const template = fs.readFileSync(path.join(__dirname, '../learning/generation-status/index.wxml'), 'utf8')
  assert.doesNotMatch(template, /查看学习计划|创建新计划/)
})

test('recitation stays locked until course learning is complete', async () => {
  const { page, navigations } = setup({
    loadCurrentLearningPlans: async () => plans('in_progress'),
    createCurrentCourseGenerationQuote: () => { throw Error('Unexpected quote') },
    confirmCurrentCourseGeneration: () => { throw Error('Unexpected charge') }
  })
  await page.onShow()
  assert.equal(page.data.result.canStartAcceptance, false)
  page.startAcceptance()
  assert.deepEqual(navigations, [])
  page.onHide()
})

test('completed course secondary page opens the recitation entry', async () => {
  for (const status of ['lesson_completed', 'awaiting_acceptance']) {
    const { page, navigations } = setup({ loadCurrentLearningPlans: async () => plans(status) })
    await page.onShow()
    assert.equal(page.data.result.canStartAcceptance, true, status)
    page.startAcceptance()
    assert.deepEqual(navigations, ['/learning/acceptance-entry/index?courseInstanceId=21'], status)
    page.onHide()
  }
  const template = fs.readFileSync(path.join(__dirname, '../learning/generation-status/index.wxml'), 'utf8')
  assert.match(template, /bindtap="startAcceptance"/)
  assert.match(template, /完成课程后解锁复述/)
})

test('generation polling reaches a ready course without another manual refresh and then stops', async () => {
  const { page, timers, service } = setup()
  await page.onShow()
  assert.equal(page.data.result.status, 'queued')
  assert.equal(timers.size, 1)
  service.loadCurrentLearningPlans = async () => plans('ready')
  const [id, tick] = [...timers][0]; timers.delete(id)
  await tick()
  assert.equal(page.data.result.canLaunch, true)
  assert.equal(timers.size, 0)
})

test('usage collection and settlement keep polling and never claim the course is already generated', async () => {
  for (const status of ['usage_collecting', 'settling']) {
    const { page, timers } = setup({ loadCurrentLearningPlans: async () => {
      const data = plans('generating', '')
      data.plans[0].items[0].courseInstances[0].generationJob = { status }
      return data
    } })
    await page.onShow()
    assert.equal(page.data.result.canLaunch, false)
    assert.notEqual(page.data.result.title, '等待生成')
    assert.equal(page.data.result.copy.includes('课程内容已生成'), false)
    assert.equal(timers.size, 1)
    page.onHide()
  }
})

test('a completed job does not open a course before its business record is ready', async () => {
  const { page, timers, navigations } = setup({ loadCurrentLearningPlans: async () => {
    const data = plans('generating', 'lesson')
    data.plans[0].items[0].courseInstances[0].generationJob = { status: 'ready' }
    return data
  } })
  await page.onShow(); page.startCourse()
  assert.equal(page.data.result.canLaunch, false)
  assert.equal(timers.size, 1)
  assert.deepEqual(navigations, [])
  page.onHide()
})

test('an unavailable explicit course never falls back to creating a different course', async () => {
  const { page } = setup()
  page.courseInstanceId = 'missing'
  await page.onShow()
  assert.equal(page.data.result, null)
})

test('learning and review states match the server access states', async () => {
  for (const status of ['ready', 'in_progress', 'lesson_completed', 'awaiting_acceptance', 'passed']) {
    const { page, navigations } = setup({ loadCurrentLearningPlans: async () => plans(status) })
    await page.onShow()
    assert.equal(page.data.result.canLaunch, true, status)
    assert.notEqual(page.data.result.title, '等待生成', status)
    page.startCourse()
    assert.deepEqual(navigations, ['/learning/course/index?courseInstanceId=21'])
  }
})

test('missing content and disabled courses never offer a learning link', async () => {
  for (const [status, content] of [['ready', ''], ['closed', 'lesson'], ['failed', 'lesson'], ['voided_quality_issue', 'lesson']]) {
    const { page, navigations } = setup({ loadCurrentLearningPlans: async () => plans(status, content) })
    await page.onShow(); page.startCourse()
    assert.equal(page.data.result.canLaunch, false)
    assert.deepEqual(navigations, [])
    page.onHide()
  }
})

test('released generation credits are shown as returned rather than still frozen', async () => {
  for (const [status, title] of [['failed', '生成失败'], ['cancelled', '课程已取消'], ['voided_credit_limit', '课程已作废']]) {
    const { page, timers } = setup({ loadCurrentLearningPlans: async () => {
      const data = plans(status, '')
      data.plans[0].items[0].courseInstances[0].creditSettlement = { status: 'released', frozenCredits: 20, voidedCredits: 20, actualCredits: null, returnedCredits: 0 }
      return data
    } })
    await page.onShow()
    assert.equal(page.data.result.title, title)
    assert.equal(page.data.result.settlementNote, '本次冻结积分已退回 20 积分。')
    assert.equal(page.data.result.canLaunch, false)
    assert.equal(timers.size, 0)
  }
})

test('hidden pages cancel polling and ignore late replies', async () => {
  let resolve
  const { page, timers } = setup({ loadCurrentLearningPlans: () => new Promise((done) => { resolve = done }) })
  const pending = page.onShow()
  page.onHide()
  resolve(plans('ready'))
  await pending
  assert.equal(page.data.result, null)
  assert.equal(timers.size, 0)
})

test('newer loads win when earlier replies arrive last', async () => {
  const replies = []
  const { page } = setup({ loadCurrentLearningPlans: () => new Promise((done) => replies.push(done)) })
  const old = page.onShow(), latest = page.loadPage()
  replies[1](plans('ready')); await latest
  replies[0](plans('queued')); await old
  assert.equal(page.data.result.status, 'ready')
})

test('an expired quote can be replaced but an uncertain failure keeps its idempotency key', async () => {
  for (const code of ['QUOTE_EXPIRED', 'NETWORK_ERROR']) {
    const { page } = setup({
      loadCurrentLearningPlans: async () => plans(null),
      confirmCurrentCourseGeneration: async () => { throw Object.assign(new Error(code), { code }) }
    })
    page.courseInstanceId = ''
    await page.onShow()
    page.setData({ quote: { quoteId: '31' } }); page.quoteKey = 'quote-old'; page.confirmKey = 'confirm-old'
    await page.startGeneration()
    assert.equal(page.data.quote === null, code === 'QUOTE_EXPIRED')
    assert.equal(page.confirmKey, code === 'QUOTE_EXPIRED' ? '' : 'confirm-old')
  }
})

test('a standalone generation entry returns to the learning tab', () => {
  const { page, navigations } = setup()
  page.goBack()
  assert.deepEqual(navigations, ['/pages/learning/index'])
})

test('a competing confirmation reloads the existing course without requesting another quote', async () => {
  let confirms = 0, quotes = 0
  const { page, service } = setup({
    loadCurrentLearningPlans: async () => plans(null),
    createCurrentCourseGenerationQuote: async () => { quotes++; return {} },
    confirmCurrentCourseGeneration: async () => {
      confirms++
      throw Object.assign(new Error('该任务已创建课程，正在刷新生成状态。'), { code: 'COURSE_ALREADY_REQUESTED' })
    }
  })
  page.courseInstanceId = ''
  await page.onShow()
  page.setData({ quote: { quoteId: '31' } })
  service.loadCurrentLearningPlans = async () => plans('queued', '')
  await page.startGeneration()
  assert.equal(page.data.quote, null)
  assert.equal(page.data.result.canStartGeneration, false)
  assert.equal(page.data.result.status, 'queued')
  assert.equal(confirms, 1)
  assert.equal(quotes, 0)
  page.onHide()
})

test('quote, confirm and polling form one course journey and repeated taps do not duplicate requests', async () => {
  const quoteCalls = [], confirmCalls = []
  let finishQuote, finishConfirm
  const { page, service, timers, navigations } = setup({
    loadCurrentLearningPlans: async () => plans(null),
    createCurrentCourseGenerationQuote: (itemId, key) => {
      quoteCalls.push({ itemId, key })
      return new Promise(resolve => { finishQuote = resolve })
    },
    confirmCurrentCourseGeneration: (quoteId, key) => {
      confirmCalls.push({ quoteId, key })
      return new Promise(resolve => { finishConfirm = resolve })
    }
  })
  page.courseInstanceId = ''
  await page.onShow()
  assert.equal(page.data.result.canStartGeneration, true)
  const quoting = page.requestQuote()
  await page.requestQuote()
  assert.equal(quoteCalls.length, 1)
  assert.equal(quoteCalls[0].itemId, '11')
  assert.equal(page.data.quoting, true)
  finishQuote({ quoteId: '31', estimatedLowerCredits: 16, estimatedUpperCredits: 20,
    frozenTargetCredits: 20, expiresAt: new Date(Date.now() + 600000).toISOString() })
  await quoting
  assert.equal(page.data.quote.frozenTargetDisplay, 20)
  assert.equal(page.data.quoting, false)
  assert.equal(confirmCalls.length, 0)
  page.startCourse()
  assert.deepEqual(navigations, [])

  const confirming = page.startGeneration()
  await page.startGeneration()
  assert.equal(confirmCalls.length, 1)
  assert.equal(confirmCalls[0].quoteId, '31')
  assert.notEqual(confirmCalls[0].key, quoteCalls[0].key)
  assert.equal(page.data.starting, true)
  service.loadCurrentLearningPlans = async () => plans('queued', '')
  finishConfirm({ courseInstanceId: '21', generationJobId: '41', reused: false })
  await confirming
  assert.equal(page.data.quote, null)
  assert.equal(page.data.starting, false)
  assert.equal(page.data.result.canStartGeneration, false)
  assert.equal(page.data.result.canLaunch, false)
  assert.equal(timers.size, 1)

  service.loadCurrentLearningPlans = async () => plans('ready', 'server-saved-lesson')
  const [id, tick] = [...timers][0]
  timers.delete(id)
  await tick()
  assert.equal(page.data.result.canLaunch, true)
  assert.equal(timers.size, 0)
  page.startCourse()
  assert.deepEqual(navigations, ['/learning/course/index?courseInstanceId=21'])
  assert.equal(quoteCalls.length, 1)
  assert.equal(confirmCalls.length, 1)
  page.onHide()
})
