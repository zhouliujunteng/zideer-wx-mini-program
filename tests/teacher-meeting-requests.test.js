// 诊断会议派单（2026-11-13）：代理申请免费诊断会议后，服务老师在小程序自己接单，接单后孩子加到自己的学生里。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { decorateRequest, sinceText } = require('../utils/meeting-request-view')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const NOW = Date.parse('2026-11-13T04:00:00Z')

const request = (extra = {}) => ({
  guardianPublicId: '100010', guardianName: '张家长', agentName: '李妈妈', note: '周六上午方便，想解决分数计算',
  children: [{ studentProfileId: '601', name: '张一', grade: 5 }, { studentProfileId: '602', name: '张二', grade: 3 }],
  requestedAt: '2026-11-13T02:25:00Z', claimedAt: '', state: 'open', ...extra
})

function loadPage(service) {
  let definition
  const calls = { navigations: [], toasts: [], modals: [] }
  vm.runInNewContext(read('teacher/meeting-requests/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    Date,
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      showModal: (options) => { calls.modals.push(options); options.success({ confirm: true }) },
      navigateTo: (options) => calls.navigations.push(options.url)
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/meeting-request-view')) return require('../utils/meeting-request-view')
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad()
  return { page, calls }
}

test('列表文字：孩子与年级、代理、等了多久、状态', () => {
  assert.equal(sinceText('2026-11-13T03:59:40Z', NOW), '刚刚')
  assert.equal(sinceText('2026-11-11T03:00:00Z', NOW), '2 天')
  assert.deepEqual(
    (({ childrenText, agentText, waitText, stateText, hasChild }) => ({ childrenText, agentText, waitText, stateText, hasChild }))(decorateRequest(request(), NOW)),
    { childrenText: '张一 · 小学五年级、张二 · 小学三年级', agentText: '代理 李妈妈', waitText: '1 小时前申请', stateText: '待接单', hasChild: true }
  )
  assert.equal(decorateRequest(request({ children: [] }), NOW).childrenText, '还没有绑定孩子')
  assert.equal(decorateRequest(request({ state: 'claimed' }), NOW).stateText, '已接单，待约会议')
})

test('第一次读到前画骨架；读到后列出待接单和我接的；接单要确认，成功后换成最新名单', async () => {
  let release
  const claimed = []
  const { page, calls } = loadPage({
    loadTeacherMeetingRequests: () => new Promise((resolve) => { release = resolve }),
    claimTeacherMeetingRequest: async (id) => {
      claimed.push(id)
      return { students: [{ studentProfileId: '601', name: '张一' }], open: [], mine: [request({ state: 'claimed', claimedAt: '2026-11-13T04:00:00Z' })] }
    }
  })
  page.onShow()
  assert.equal(page.data.loaded, false)
  release({ open: [request()], mine: [] })
  await flush()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.open.length, 1)
  page.handleClaim({ currentTarget: { dataset: { id: '100010' } } })
  assert.match(calls.modals[0].content, /张一.*会加到你的学生里/)
  await flush()
  assert.deepEqual(claimed, ['100010'])
  assert.equal(page.data.open.length, 0)
  assert.equal(page.data.mine[0].stateText, '已接单，待约会议')
  assert.equal(page.data.claiming, '')
  assert.deepEqual(calls.toasts, ['已接单'])
  // 我接的：点进第一个孩子的学生详情去约会议
  page.openStudent({ currentTarget: { dataset: { id: '100010' } } })
  assert.match(calls.navigations[0], /^\/teacher\/student-detail\/index\?studentProfileId=601&/)
})

test('被别的老师接走：提示原因并刷新名单；家长没绑孩子的不能接', async () => {
  let reads = 0
  const { page, calls } = loadPage({
    loadTeacherMeetingRequests: async () => (++reads === 1 ? { open: [request(), request({ guardianPublicId: '100012', children: [] })], mine: [] } : { open: [], mine: [] }),
    claimTeacherMeetingRequest: async () => { throw new Error('这条申请刚被别的老师接走了。') }
  })
  page.onShow()
  await flush()
  page.handleClaim({ currentTarget: { dataset: { id: '100012' } } })
  assert.equal(calls.modals.length, 0)
  assert.match(calls.toasts[0], /还没有绑定孩子/)
  page.handleClaim({ currentTarget: { dataset: { id: '100010' } } })
  await flush()
  await flush()
  assert.equal(calls.toasts[1], '这条申请刚被别的老师接走了。')
  assert.equal(reads, 2)
  assert.equal(page.data.open.length, 0)
})

test('第一次就读不到：显示原因和重试，不显示「没有申请」；读到过以后刷新失败保留旧名单', async () => {
  let fail = true
  const { page } = loadPage({
    loadTeacherMeetingRequests: async () => { if (fail) throw new Error('当前账号不是在职老师，无法核验。'); return { open: [request()], mine: [] } },
    claimTeacherMeetingRequest: async () => ({})
  })
  page.onShow()
  await flush()
  assert.equal(page.data.failed, true)
  assert.equal(page.data.loaded, false)
  assert.equal(page.data.error, '当前账号不是在职老师，无法核验。')
  fail = false
  await page.loadPage()
  assert.equal(page.data.failed, false)
  assert.equal(page.data.open.length, 1)
  fail = true
  await page.loadPage()
  assert.equal(page.data.failed, false)
  assert.equal(page.data.open.length, 1)
  const template = read('teacher/meeting-requests/index.wxml')
  assert.match(template, /wx:if="\{\{failed && !loaded\}\}"/)
  assert.match(template, /wx:if="\{\{!loaded\}\}"/)
})

test('页面已注册；老师工作台有入口；接口封装调课程服务 /api/teacher/meeting-requests', () => {
  assert.ok(JSON.parse(read('app.json')).subpackages.find((pkg) => pkg.root === 'teacher').pages.includes('meeting-requests/index'))
  assert.match(read('teacher/workspace/index.wxml'), /bindtap="openMeetingRequests"/)
  assert.match(read('teacher/workspace/index.js'), /\/teacher\/meeting-requests\/index/)
  const identity = read('services/identity.js')
  assert.match(identity, /requestAgentCourses\('\/api\/teacher\/meeting-requests', token, \{ timeout/)
  assert.match(identity, /data: \{ operation: 'claim', guardianPublicId: id \}/)
  for (const code of ['MEETING_TAKEN', 'FAMILY_NO_CHILD', 'TEACHER_CAPACITY_FULL']) assert.match(identity, new RegExp(`${code}: '`))
})

test('代理「免费体验」页写出是哪位老师接了单', () => {
  const source = read('agent/family-trial/index.js')
  assert.match(source, /已接单，会联系你约具体时间/)
  assert.match(source, /已通知服务老师，等老师接单/)
})
