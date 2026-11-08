const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const memberModel = {
  student: null,
  notifications: {},
  overview: [],
  learningCards: [],
  studyTasks: [],
  studyTaskCalendar: [],
  studyTaskEmptyText: '',
  hasLibraryAccess: false,
  moreCourses: []
}

function loadLiveTabService({ library, access = 'ready', dashboard }) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/live-tab-service.js'), 'utf8'), {
    module,
    require: (name) => name === './mock-service'
      ? { getHomeModel: () => JSON.parse(JSON.stringify(memberModel)) }
      : {
          loadHomeDashboard: dashboard || (async () => ({ students: [], today: null, assessment: null, balances: null, plan: null })),
          loadViewerAccess: async () => access,
          loadMemberCourseLibrary: library
        }
  })
  return module.exports
}

// 2026-09-27 用户规则：未登录也能浏览。首页只读会员课程列表，不再先读要学习档案的整套首页数据。
test('guests and accounts without a learning profile still get the member course list', async () => {
  for (const access of ['guest', 'profile']) {
    let dashboardReads = 0
    const service = loadLiveTabService({
      access,
      dashboard: async () => { dashboardReads += 1; throw Object.assign(new Error('请先完善学习资料。'), { code: 'PROFILE_REQUIRED' }) },
      library: async () => [{ id: 'a'.repeat(32), title: '氧化还原反应', subject: '化学', grade: '高中', isMember: false }]
    })
    const { model } = await service.getLiveHomeModel()
    assert.equal(model.access, access)
    assert.equal(model.moreCourses.length, 1)
    assert.equal(model.moreCourses[0].isMember, false)
    assert.equal(dashboardReads, 0)
  }
})

test('a failed course list read surfaces as a failure instead of an empty shelf', async () => {
  const service = loadLiveTabService({ library: async () => { throw new Error('课程库暂时无法读取，请稍后重试。') } })
  await assert.rejects(service.getLiveHomeModel(), /课程库暂时无法读取/)
})

test('member home lists published library courses for members', async () => {
  const service = loadLiveTabService({
    library: async () => [
      { id: 'a'.repeat(32), title: '氧化还原反应', subject: '化学', grade: '高中', coverUrl: 'https://course.example/api/course-covers/' + 'c'.repeat(64) + '.jpg' },
      { id: 'b'.repeat(32), title: '三角函数专题', subject: '', grade: '' }
    ]
  })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, true)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [
    { id: 'a'.repeat(32), title: '氧化还原反应', subtitle: '化学 · 高中 年级', isMember: true, coverUrl: 'https://course.example/api/course-covers/' + 'c'.repeat(64) + '.jpg', tone: 0 },
    { id: 'b'.repeat(32), title: '三角函数专题', subtitle: '会员公共课程', isMember: true, coverUrl: '', tone: 1 }
  ])
})

test('member home hides the library section without membership', async () => {
  const service = loadLiveTabService({
    library: async () => { const error = new Error('当前账号暂无课程库访问权限。'); error.code = 'MEMBERSHIP_REQUIRED'; throw error }
  })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, false)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [])
})

test('member home hides the library section when it resolves empty', async () => {
  const service = loadLiveTabService({ library: async () => [] })
  const { model } = await service.getLiveHomeModel()
  assert.equal(model.hasLibraryAccess, false)
  assert.deepEqual(JSON.parse(JSON.stringify(model.moreCourses)), [])
})

const pagePath = require.resolve('../pages/home/index.js')

function loadPage() {
  delete require.cache[pagePath]

  let definition = null
  const navigations = []
  global.Page = (page) => { definition = page }
  global.wx = {
    navigateTo(options) { navigations.push(options) }
  }
  require(pagePath)

  const instance = {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values) }
  }
  return { definition, instance, navigations }
}

test('home course cards open the member library course webview', () => {
  const { definition, instance, navigations } = loadPage()
  const id = 'c5f0d3ab7890124567abcdef01234567'

  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id } } })
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id: '../private' } } })
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: {} } })
  definition.openLibraryList.call(instance)

  assert.deepEqual(navigations, [
    { url: `/learning/course/index?libraryCourseId=${id}` },
    { url: '/learning/library/index' }
  ])
})

// 2026-09-30 用户要求：没登录、不是会员时点会员课程，进定制课程介绍页（不再弹窗提示开通会员、不直接跳登录）。
test('home course card sends non-members to the custom course intro before opening the course', () => {
  const { definition, instance, navigations } = loadPage()
  const modals = []
  global.wx.showModal = (options) => { modals.push(options); options.success({ confirm: true }) }
  const locked = 'd'.repeat(32)
  const open = 'e'.repeat(32)
  instance.data.model.moreCourses = [
    { id: locked, title: '会员课 & 分数', isMember: false },
    { id: open, title: '已开通', isMember: true }
  ]

  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id: locked } } })
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id: open } } })

  assert.equal(modals.length, 0)
  assert.deepEqual(navigations, [
    { url: `/learning/custom-course-intro/index?libraryCourseId=${locked}&title=${encodeURIComponent('会员课 & 分数')}` },
    { url: `/learning/course/index?libraryCourseId=${open}` }
  ])
})

test('home course cards send guests and accounts without a profile to the custom course intro', () => {
  const { definition, instance, navigations } = loadPage()
  const modals = []
  global.wx.showModal = (options) => { modals.push(options); options.success({ confirm: true }) }
  const id = 'f'.repeat(32)
  instance.data.model = { access: 'guest', moreCourses: [{ id, title: '会员课', isMember: false }] }
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id } } })
  instance.data.model = { access: 'profile', moreCourses: [{ id, title: '会员课', isMember: false }] }
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id } } })
  // 会员但还没建档（少见）：照旧先完善学习资料
  instance.data.model = { access: 'profile', moreCourses: [{ id, title: '会员课', isMember: true }] }
  definition.openLibraryCourse.call(instance, { currentTarget: { dataset: { id } } })

  const intro = `/learning/custom-course-intro/index?libraryCourseId=${id}&title=${encodeURIComponent('会员课')}`
  assert.deepEqual(modals.map((modal) => modal.title), ['请先完善学习资料'])
  assert.deepEqual(navigations, [{ url: intro }, { url: intro }, { url: '/pages/profile-setup/index' }])
})

test('library loader keeps the server membership flag', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8')
  assert.match(source, /isMember: course\.isMember !== false/)
})

test('course cards show generated covers and let long titles wrap', () => {
  const home = fs.readFileSync(path.join(__dirname, '../pages/home/index.wxml'), 'utf8')
  assert.match(home, /<image wx:if="\{\{item.coverUrl\}\}" class="more-course-cover-image" src="\{\{item.coverUrl\}\}"/)
  const css = fs.readFileSync(path.join(__dirname, '../styles/course-grid.wxss'), 'utf8')
  const rule = css.slice(css.indexOf('.more-course-title {'), css.indexOf('}', css.indexOf('.more-course-title {')))
  assert.doesNotMatch(rule, /nowrap/)
  assert.match(rule, /-webkit-line-clamp: 3/)
})

// 2026-09-24 用户要求：「我的课程」与首页「会员课程」展示一模一样，搜索框同会员课程全部页，「课程库」链接同「查看全部」。
test('我的课程 uses the same cards, link and search box as the home and library pages', () => {
  const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  for (const file of ['pages/home/index.wxss', 'pages/learning/index.wxss', 'learning/library/index.wxss']) {
    assert.match(read(file), /@import "\.\.\/\.\.\/styles\/course-grid\.wxss";/, file)
  }
  const cardClasses = (wxml, loop) => {
    const start = wxml.indexOf(`wx:for="{{${loop}}}"`)
    return [...wxml.slice(start, wxml.indexOf('</view>\n', wxml.indexOf('more-course-subtitle', start))).matchAll(/class="([a-z-]+)/g)].map((m) => m[1])
  }
  const home = read('pages/home/index.wxml')
  const learning = read('pages/learning/index.wxml')
  // 封面角标（制作中进度）与系列名（定制系列，2026-10-06）只有「我的课程」有
  const shared = (c) => c !== 'more-course-tag' && c !== 'more-course-series'
  assert.deepEqual(cardClasses(learning, 'seriesCourses').filter(shared), cardClasses(home, 'model.moreCourses').filter(shared))
  assert.match(learning, /<view class="task-all-link" bindtap="openLibrary"[^>]*><text>课程库<\/text><view class="task-all-icon"/)
  assert.match(learning, /class="course-search[ "][\s\S]*?class="course-search-icon"[\s\S]*?class="course-search-input"[^>]*placeholder="搜索课程"/)
  assert.match(read('learning/library/index.wxml'), /class="course-search"[\s\S]*?class="course-search-input"[^>]*placeholder="搜索课程"/)
  // 卡片、搜索框样式只在共用文件里定义，页面里不再各写一份
  for (const file of ['pages/home/index.wxss', 'pages/learning/index.wxss', 'learning/library/index.wxss']) {
    assert.doesNotMatch(read(file), /^\.(more-course-title|more-course-cover|course-search-input) \{/m, file)
  }
})
