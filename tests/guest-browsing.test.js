// 2026-09-27 用户规则：按微信小程序平台规则，未登录也能浏览小程序——首页看得到会员课程，图谱提示先完善学习资料；
// 已登录、没完善学习资料的，首页照常出课程，其余 tab 页提示去完善，不再整页读取失败。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const config = require('../config/index')
const phoneStatus = require('./helpers/verified-phone-session')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const profileRequired = () => Object.assign(new Error('请先完善学习资料。'), { code: 'PROFILE_REQUIRED' })

// 一份独立的 services/identity.js：token 为空就是游客；flows 按动作流 id 给结果，library 回课程服务的课程列表。
function identityService({ token = '', route = 'pages/home/index', flows = {}, library } = {}) {
  const state = { token, requests: [], navigations: [] }
  const wx = {
    getStorageSync: (key) => key === 'zion_runtime_token' ? state.token : '',
    setStorageSync: (key, value) => { if (key === 'zion_runtime_token') state.token = value },
    removeStorageSync: (key) => { if (key === 'zion_runtime_token') state.token = '' },
    reLaunch: (options) => state.navigations.push(options.url),
    request(options) {
      state.requests.push(options)
      if (phoneStatus(options)) return
      if (/\/api\/learn\/library$/.test(options.url)) return options.success(library(options))
      const id = (String(options.data && options.data.query).match(/actionFlowId:\s*"([^"]+)"/) || [])[1]
      options.success({ statusCode: 200, data: { data: { result: flows[id] } } })
    }
  }
  global.wx = wx
  const module = { exports: {} }
  vm.runInNewContext(read('services/identity.js'), {
    module, wx, console,
    getApp: () => ({ globalData: {} }),
    getCurrentPages: () => [{ route }],
    require: (name) => require(path.join(__dirname, '../services', name))
  })
  return { api: module.exports, state }
}

const flows = config.ACTION_FLOWS
const ready = (extra = {}) => ({ [flows.INITIALIZE_CURRENT_USER.id]: 901, [flows.GET_CURRENT_LEARNING_PROFILE.id]: { id: 902, nickname: '小鹿', public_id: '234567', profile_completed_at: '2026-09-01T00:00:00Z' }, ...extra })
const noProfile = (extra = {}) => ({ [flows.INITIALIZE_CURRENT_USER.id]: 901, [flows.GET_CURRENT_LEARNING_PROFILE.id]: null, ...extra })

test('guests read the member course list without a credential and are never sent to login', async () => {
  const { api, state } = identityService({
    library: () => ({ statusCode: 200, data: { courses: [{ id: 'a'.repeat(32), title: '一次函数', subject: '数学', grade: '8', isMember: false }] } })
  })
  const courses = await api.loadMemberCourseLibrary()
  assert.deepEqual(courses.map((course) => [course.title, course.isMember]), [['一次函数', false]])
  assert.equal(state.requests.length, 1)
  assert.equal(state.requests[0].header.authorization, undefined)
  assert.equal(await api.loadViewerAccess(), 'guest')
  assert.equal(state.requests.length, 1)
  assert.deepEqual(state.navigations, [])
})

test('viewer access tells a guest, an account without a learning profile and a ready student apart', async () => {
  assert.equal(await identityService().api.loadViewerAccess(), 'guest')
  assert.equal(await identityService({ token: 'signed-in', flows: noProfile() }).api.loadViewerAccess(), 'profile')
  assert.equal(await identityService({ token: 'signed-in', flows: ready() }).api.loadViewerAccess(), 'ready')
})

test('reads that need a learning profile fail with a code the pages turn into a prompt', async () => {
  const { api } = identityService({
    token: 'signed-in',
    flows: noProfile({
      [flows.GET_CURRENT_STUDENT_KNOWLEDGE_MAP.id]: { status: 'profile_required' },
      [flows.GET_CURRENT_LEARNING_CHECKIN.id]: { status: 'not_initialized' }
    })
  })
  for (const read of [api.loadLearningDashboard, api.loadKnowledgeUniverse, api.loadKnowledgeMap, api.loadCurrentLearningCheckin]) {
    await assert.rejects(read(), (error) => api.accessOfError(error) === 'profile')
  }
  assert.equal(api.accessOfError(Object.assign(new Error('x'), { code: 'AUTH_REQUIRED' })), 'guest')
  assert.equal(api.accessOfError(new Error('网络不可用')), '')
})

test('the account summary still loads for an account without a learning profile', async () => {
  const { api } = identityService({ token: 'signed-in', flows: noProfile({ [flows.GET_CURRENT_CREDIT_ACCOUNT.id]: new Error('请先完善学生学习档案。') }) })
  const dashboard = await api.loadMeDashboard()
  assert.equal(dashboard.profile.completed, false)
  assert.equal(dashboard.profile.displayName, '学习用户')
  assert.equal(dashboard.profile.publicId, '')
  assert.equal(dashboard.students.length, 0)
  const complete = await identityService({ token: 'signed-in', flows: ready() }).api.loadMeDashboard()
  assert.equal(complete.profile.completed, true)
  assert.equal(complete.profile.publicId, '234567')
})

function liveTabService(identity) {
  const module = { exports: {} }
  vm.runInNewContext(read('services/live-tab-service.js'), {
    module,
    require: (name) => {
      if (name === './identity') return identity
      if (name === './learning-streak') return {}
      return require(path.join(__dirname, '../services', name))
    }
  })
  return module.exports
}

test('the learning tab gives guests its fixed structure without reading anything, and prompts accounts without a profile', async () => {
  let reads = 0
  const read = async () => { reads += 1; throw profileRequired() }
  const identity = { hasSession: () => false, accessOfError: (error) => error.code === 'PROFILE_REQUIRED' ? 'profile' : '', loadLearningDashboard: read, loadAgentCourses: async () => [], loadCurrentLearningCheckin: async () => null }
  const guest = await liveTabService(identity).getLiveLearningModel()
  assert.equal(guest.access, 'guest')
  assert.equal(guest.model.studyTaskCalendar.length, 7)
  assert.equal(guest.model.myCourses.length, 0)
  assert.equal(reads, 0)
  identity.hasSession = () => true
  const incomplete = await liveTabService(identity).getLiveLearningModel()
  assert.equal(incomplete.access, 'profile')
  assert.equal(reads, 1)
})

test('the me tab shows guests the entries with — for balances, and hides balances of accounts without a profile', async () => {
  let dashboardReads = 0
  const identity = {
    hasSession: () => false,
    accessOfError: () => '',
    loadMeDashboard: async () => { dashboardReads += 1; return { profile: { displayName: '学习用户', publicId: '', completed: false, accountType: 'student' }, balances: null } },
    loadCurrentGrowthCenter: async () => null
  }
  global.wx = { getStorageSync: () => '' }
  const guest = await liveTabService(identity).getLiveMeModel()
  assert.equal(guest.access, 'guest')
  assert.equal(dashboardReads, 0)
  assert.equal(guest.accountSummary.map((item) => item.value).join(','), '—,—')
  assert.ok(guest.quickActions.length > 0 && guest.serviceGroups.length > 0)
  identity.hasSession = () => true
  const incomplete = await liveTabService(identity).getLiveMeModel()
  assert.equal(incomplete.access, 'profile')
  assert.equal(incomplete.profile.name, '学习用户')
  assert.equal(incomplete.accountSummary.map((item) => item.value).join(','), '—,—')
})

test('the streak entries show guests the unlit flame without reading, and ask for a profile when the backend needs one', async () => {
  const storePath = require.resolve('../services/learning-streak.js')
  const identityPath = require.resolve('../services/identity.js')
  const storage = {}
  let reads = 0
  delete require.cache[storePath]
  require.cache[identityPath] = { id: identityPath, filename: identityPath, loaded: true, exports: { loadCurrentLearningCheckin: async () => { reads += 1; throw profileRequired() } } }
  global.wx = { getStorageSync: (key) => storage[key] }
  const store = require(storePath)
  delete require.cache[identityPath]
  assert.equal(store.getStreakState().status, 'guest')
  assert.equal((await store.refreshStreak()).status, 'guest')
  assert.equal(reads, 0)
  storage.zion_runtime_token = 'signed-in'
  assert.equal((await store.refreshStreak()).status, 'profile')
  assert.equal(reads, 1)
  const card = read('components/streak-card/index.wxml')
  assert.match(card, /streakStatus === 'guest' \? '登录后开始记录' : '完善学习资料后开始记录'/)
})

// 页面：模块按后缀换成桩，其余照常加载；utils/access-gate 用真的，跳转记在 calls 里。
function loadPage(file, modules) {
  let definition
  const calls = { navigate: [], toast: [], modal: [] }
  const wx = {
    navigateTo: (options) => calls.navigate.push(options.url),
    showToast: (options) => calls.toast.push(options.title),
    showModal: (options) => { calls.modal.push(options.title); if (options.success) options.success({ confirm: true }) },
    switchTab() {}, nextTick: (fn) => fn(), vibrateShort() {}, stopPullDownRefresh() {},
    getStorageSync: () => '',
    getWindowInfo: () => ({ windowWidth: 375, windowHeight: 812, statusBarHeight: 44 }),
    getMenuButtonBoundingClientRect: () => ({ left: 281, top: 50, width: 87, height: 32 }),
    createSelectorQuery: () => ({ select: () => ({ boundingClientRect: () => ({ exec() {} }) }) })
  }
  global.wx = wx
  vm.runInNewContext(read(file), {
    Page(page) { definition = page }, getApp: () => ({}), wx, console, setTimeout, clearTimeout,
    require(name) {
      const key = Object.keys(modules).find((suffix) => name.endsWith(suffix))
      if (key) return modules[key]
      if (name.endsWith('/payment-switch')) return paymentSwitchStub(wx)
      return require(path.join(__dirname, '..', path.dirname(file), name))
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch, callback) {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.split('.')
      let target = this.data
      while (parts.length > 1) target = target[parts.shift()]
      target[parts[0]] = value
    }
    if (callback) callback()
  } }
  return { page, calls }
}

const { accessOfError } = require('../services/identity')

// 2026-09-30 用户要求（审核需要）：没登录、没完善学习资料时图谱页画一张标明「示例」的图谱，不读后端；点「去登录 / 去完善」照旧。
test('the knowledge map shows guests and accounts without a profile a labelled sample map', async () => {
  let session = false
  let reads = 0
  let topicReads = 0
  let map = async () => { reads += 1; throw profileRequired() }
  const { page, calls } = loadPage('pages/knowledge-map/index.js', {
    '/services/identity': { hasSession: () => session, accessOfError, loadKnowledgeMap: (...args) => map(...args), loadKnowledgeTopic: async () => { topicReads += 1; return {} } },
    '/services/ui-assets': { attachUiAssets() {} },
    '/utils/account-role': { isGuardianAccount: () => false }
  })
  for (const key of ['cancelSelectionFlowAnimation', 'cancelGraphDraw', 'stopMetricsPanel']) page[key] = () => {}
  page._metrics = { reset() {}, now: () => 1, record() {} }
  page._frameLatencyTracker = { reset() {} }

  await page.onShow()
  assert.deepEqual([page.data.access, page.data.sampleMode, page.data.mapLoaded, reads], ['guest', true, true, 0])
  assert.match(page.data.model.scopeLabel, /^示例 · 初1 · 上学期/)
  assert.deepEqual(page.data.model.courses.map((course) => course.title), ['数学', '英语', '生物'])
  assert.ok(page._graphModel.nodes.length > 20 && page._graphModel.nodes.every((node) => /^sample-/.test(node.id)))
  assert.ok(new Set(page._graphModel.nodes.map((node) => node.status)).size >= 5)

  // 切学科、点知识点都用本地数据
  page.selectCourse({ currentTarget: { dataset: { id: 'eng' } } })
  assert.equal(page.data.activeSubjectKey, 'eng')
  assert.equal(reads, 0)
  page.selectCourse({ currentTarget: { dataset: { id: 'math' } } })
  for (const key of ['buildGraphScene', 'resetGraphView', 'updateMapSheetPosition']) page[key] = () => {}
  const withSuccessor = page._graphModel.nodes.find((node) => page._graphModel.edges.some((edge) => edge.from === node.id))
  await page.selectKnowledgeNode(withSuccessor)
  assert.equal(topicReads, 0)
  assert.equal(page.data.relationMode, true)
  assert.ok(page.data.selectedNode.description && page.data.successorLinks.length > 0)
  page.returnToOverview()

  page.openAccessStep()
  assert.deepEqual(calls.navigate, ['/pages/login/login'])

  // 刚登录回来还没建档：重新读自己的，读到没建档再换成示例，提示去完善
  session = true
  await page.onShow()
  assert.deepEqual([page.data.access, page.data.sampleMode, reads], ['profile', true, 1])
  assert.equal(page.data.loadError, '')
  assert.deepEqual(calls.toast, [])
  page.openAccessStep()
  assert.deepEqual(calls.navigate, ['/pages/login/login', '/pages/profile-setup/index'])

  // 建完档回来：后台读到自己的图谱就换掉示例
  map = async () => { reads += 1; return { subjects: [{ key: 'math', name: '数学' }], activeSubjectKey: 'math', grade: '初1', semester: '上学期', stats: {}, nodes: [{ id: '81', label: '有理数' }], edges: [] } }
  await page.onShow()
  assert.deepEqual([page.data.access, page.data.sampleMode, page._graphModel.nodes.map((node) => node.id)], ['', false, ['81']])

  const wxml = read('pages/knowledge-map/index.wxml')
  assert.match(wxml, /wx:if="\{\{sampleMode\}\}" class="map-sample-banner"[^>]*bindtap="openAccessStep"[\s\S]*示例/)
})

// 已登录、有学习资料的学生读取失败：照常报错，不拿示例图谱顶替
test('a real knowledge map failure never falls back to the sample map', async () => {
  const { page } = loadPage('pages/knowledge-map/index.js', {
    '/services/identity': { hasSession: () => true, accessOfError, loadKnowledgeMap: async () => { throw new Error('知识库正在准备，请稍后重试。') }, loadKnowledgeTopic: async () => ({}) },
    '/services/ui-assets': { attachUiAssets() {} },
    '/utils/account-role': { isGuardianAccount: () => false }
  })
  for (const key of ['cancelSelectionFlowAnimation', 'cancelGraphDraw', 'stopMetricsPanel']) page[key] = () => {}
  page._metrics = { reset() {}, now: () => 1, record() {} }
  page._frameLatencyTracker = { reset() {} }
  await page.onShow()
  assert.deepEqual([page.data.sampleMode, page.data.mapLoaded, page.data.loadError], [false, false, '知识库正在准备，请稍后重试。'])
})

test('the universe tab shows a prompt instead of a load failure', async () => {
  let session = false
  const { page, calls } = loadPage('pages/knowledge-universe/index.js', {
    '/services/identity': { hasSession: () => session, accessOfError, loadKnowledgeUniverse: async () => { throw profileRequired() } },
    '/services/ui-assets': { attachUiAssets() {} }
  })
  await page.loadUniverse()
  assert.equal(page.data.access, 'guest')
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.loadFailed, false)
  session = true
  await page.loadUniverse()
  assert.equal(page.data.access, 'profile')
  assert.equal(page.data.loadFailed, false)
  page.openAccessStep()
  assert.deepEqual(calls.navigate, ['/pages/profile-setup/index'])
})

test('the learning tab shows guests a login prompt and sends its course library link to login', async () => {
  const { page, calls } = loadPage('pages/learning/index.js', {
    '/live-tab-service': { getLearningSkeletonModel: () => ({ studyTasks: [], myCourses: [] }), getLiveLearningModel: async () => ({ model: { studyTasks: [], myCourses: [] }, dashboard: null, access: 'guest' }) },
    '/agent-course-focus': { takeAgentCourseFocus: () => '' },
    '/services/identity': { loadCurrentServiceContacts: async () => { throw new Error('should not read contacts') }, hasSession: () => false },
    '/customer-service': { openCustomerServiceChat: async () => {}, customerServiceErrorMessage: () => '' },
    '/services/ui-assets': { attachUiAssets() {} }
  })
  await page.onShow()
  assert.equal(page.data.loaded, true)
  assert.equal(page.data.access, 'guest')
  page.openLibrary()
  page.openAccessStep()
  assert.deepEqual(calls.navigate, ['/pages/login/login', '/pages/login/login'])
  const wxml = read('pages/learning/index.wxml')
  assert.match(wxml, /wx:if="\{\{loaded && access !== 'ready'\}\}" class="access-prompt study-access-prompt"/)
})

test('the me tab lets guests browse its entries and signs them in on use', async () => {
  let membershipReads = 0
  let teacherReads = 0
  const guestModel = { access: 'guest', profile: { name: '', id: '' }, accountSummary: [{ label: '课程积分', value: '—' }], quickActions: [], serviceGroups: [] }
  const { page, calls } = loadPage('pages/me/index.js', {
    '/mock-service': { getMeModel: () => ({ profile: {}, accountSummary: [], quickActions: [] }) },
    '/live-tab-service': { getLiveMeModel: async () => guestModel, withGuardianQuickActions: (actions) => actions },
    '/services/identity': { hasSession: () => false, loadCurrentMembership: async () => { membershipReads += 1 }, loadCurrentTeacherWorkspace: async () => { teacherReads += 1 } },
    '/membership-view': require('../services/membership-view'),
    '/services/ui-assets': { attachUiAssets() {} }
  })
  await page.onShow()
  assert.equal(page.data.profileLoaded, true)
  assert.equal(page.data.membershipLoaded, true)
  assert.equal(membershipReads + teacherReads, 0)
  page.handleItem({ currentTarget: { dataset: { name: '我的订单' } } })
  page.handleItem({ currentTarget: { dataset: { name: '关于知鹿' } } })
  await page.openMembership()
  page.handleWalletTap({ currentTarget: { dataset: { name: '课程积分' } } })
  page.editProfile()
  assert.deepEqual(calls.navigate, ['/pages/login/login', '/account/about/index', '/pages/login/login', '/pages/login/login', '/pages/login/login'])
  const wxml = read('pages/me/index.wxml')
  assert.match(wxml, /wx:elif="\{\{model\.access === 'guest'\}\}" class="profile-name">登录 \/ 注册</)
})

test('the me tab keeps profile-free entries open to accounts without a profile and asks them to complete it for the rest', async () => {
  const { page, calls } = loadPage('pages/me/index.js', {
    '/mock-service': { getMeModel: () => ({ profile: {}, accountSummary: [], quickActions: [] }) },
    '/live-tab-service': { getLiveMeModel: async () => ({ access: 'profile', profile: { name: '学习用户', id: '' }, accountSummary: [], quickActions: [], serviceGroups: [] }), withGuardianQuickActions: (actions) => actions },
    '/services/identity': { hasSession: () => true, loadCurrentMembership: async () => null, loadCurrentTeacherWorkspace: async () => ({ status: 'not_teacher' }) },
    '/membership-view': require('../services/membership-view'),
    '/services/ui-assets': { attachUiAssets() {} }
  })
  global.wx.getStorageSync = (key) => key === 'zion_runtime_token' ? 'signed-in' : ''
  await page.onShow()
  page.handleItem({ currentTarget: { dataset: { name: '消息中心' } } })
  page.handleItem({ currentTarget: { dataset: { name: '身份与登录' } } })
  page.handleItem({ currentTarget: { dataset: { name: '兑换码' } } })
  page.editProfile()
  assert.deepEqual(calls.modal, ['请先完善学习资料'])
  assert.deepEqual(calls.navigate, ['/pages/messages/index', '/account/login-identities/index', '/pages/profile-setup/index', '/pages/profile-setup/index'])
})

test('a first-time profile opened while browsing returns to that page when done', () => {
  const source = read('pages/profile-setup/index.js')
  assert.match(source, /if \(\(this\.switchTarget \|\| !this\.isEditing\) && getCurrentPages\(\)\.length > 1\) \{ wx\.navigateBack\(\{ delta: 1 \}\); return \}/)
})
