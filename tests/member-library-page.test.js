const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const id = 'a'.repeat(32)
const courses = [{ id, title: 'Linear equations', subject: 'Math', grade: 'Grade 8' }]

function pageWith(load, access = 'ready') {
  let definition
  const navigations = []
  const guarded = []
  const intros = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/library/index.js'), 'utf8'), {
    Page(page) { definition = page },
    require(name) { if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups'); return { loadMemberCourseLibrary: load, loadViewerAccess: async () => access, guardAccess: (value) => { guarded.push(value); return value !== 'ready' }, openCustomCourseIntro: (course) => intros.push(course.id) } },
    wx: { navigateTo(value) { navigations.push(value.url) } }
  })
  return { page: { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }, navigations, guarded, intros }
}

test('member catalog filters by subject and opens only a listed library course', async () => {
  const { page, navigations } = pageWith(async () => courses)
  await page.loadCourses()
  page.searchCourses({ detail: { value: 'math' } })
  assert.equal(page.data.visibleCourses.length, 1)
  page.openCourse({ currentTarget: { dataset: { id } } })
  page.openCourse({ currentTarget: { dataset: { id: 'not-listed' } } })
  assert.deepEqual(navigations, [`/learning/course/index?libraryCourseId=${id}`])
  page.searchCourses({ detail: { value: 'Other subject' } })
  assert.equal(page.data.visibleCourses.length, 0)
})

// 2026-09-27 用户规则：未登录也能看会员课程列表。2026-09-30 起点课程时游客、非会员先进定制课程介绍页，
// 会员但没建档的（少见）仍先完善学习资料（utils/access-gate）。
test('guests and non-members browse the member catalog but a course tap opens the custom course intro first', async () => {
  const guest = pageWith(async () => courses, 'guest')
  await guest.page.loadCourses()
  assert.equal(guest.page.data.visibleCourses.length, 1)
  guest.page.openCourse({ currentTarget: { dataset: { id } } })
  assert.deepEqual([guest.intros, guest.guarded, guest.navigations], [[id], [], []])

  const nonMember = pageWith(async () => [{ ...courses[0], isMember: false }], 'profile')
  await nonMember.page.loadCourses()
  nonMember.page.openCourse({ currentTarget: { dataset: { id } } })
  assert.deepEqual([nonMember.intros, nonMember.guarded, nonMember.navigations], [[id], [], []])

  const memberWithoutProfile = pageWith(async () => courses, 'profile')
  await memberWithoutProfile.page.loadCourses()
  memberWithoutProfile.page.openCourse({ currentTarget: { dataset: { id } } })
  assert.deepEqual([memberWithoutProfile.intros, memberWithoutProfile.guarded, memberWithoutProfile.navigations], [[], ['profile'], []])
})

test('a late catalog reply never repopulates a hidden page, and failures clear old content', async () => {
  let reply
  const { page } = pageWith(() => new Promise((resolve) => { reply = resolve }))
  const pending = page.loadCourses()
  page.onHide()
  reply(courses)
  await pending
  assert.equal(page.data.courses.length, 0)
  const failure = pageWith(async () => { throw new Error('Unavailable') }).page
  failure.data.courses = courses
  await failure.loadCourses()
  assert.equal(failure.data.loading, false)
  assert.equal(failure.data.error, 'Unavailable')
  assert.equal(failure.data.courses.length, 0)
})

function serviceWith() {
  let token = 'student-token'
  let request
  const handoffs = []
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../services/identity.js'), 'utf8'), {
    module, require() { return { ...require('../config/index'), COURSE_PORTAL_ORIGIN: 'https://course.example' } },
    wx: {
      getStorageSync() { return token },
      request(options) {
        if (require('./helpers/verified-phone-session')(options)) return
        if (/\/api\/learn\/device$/.test(options.url)) {
          handoffs.push(options)
          return options.success({ statusCode: 200, data: { ticket: 'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL', expiresAt: Date.now() + 60000 } })
        }
        request = options
      }
    }
  })
  return { api: module.exports, request: () => request, handoffs, changeAccount() { token = 'other-token' } }
}

test('library entry uses a one-time ticket and API results never retain admin fields', async () => {
  const { api, request, handoffs } = serviceWith()
  const entryUrl = await api.createLibraryCourseLaunchUrl(id)
  assert.equal(entryUrl, `https://course.example/api/learn/entry?library=${id}&layout=focus&ticket=LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLL`)
  assert.equal(JSON.stringify(handoffs[0].data), JSON.stringify({ operation: 'handoff', libraryCourseId: id }))
  assert.equal(handoffs[0].header.authorization, 'Bearer student-token')
  await assert.rejects(api.createLibraryCourseLaunchUrl('../private'))
  const result = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  assert.equal(request().method, 'GET')
  assert.equal(request().header.authorization, 'Bearer student-token')
  request().success({ statusCode: 200, data: { courses: [{ ...courses[0], requirement: 'admin-only' }] } })
  assert.equal(JSON.stringify(await result), JSON.stringify(courses.map((course) => ({ ...course, isMember: true, coverUrl: '' }))))
})

test('a catalog request cannot deliver one account data after login changes', async () => {
  const { api, request, changeAccount } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  changeAccount()
  request().success({ statusCode: 200, data: { courses } })
  await assert.rejects(pending, /账号已变化/)
})

test('membership denial does not clear the current login or fake an empty successful catalog', async () => {
  const { api, request } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  request().success({ statusCode: 403, data: { code: 'MEMBERSHIP_REQUIRED' } })
  await assert.rejects(pending, /访问权限/)
  assert.match(await api.createLibraryCourseLaunchUrl(id), /[?&]library=/)
})

test('a legacy server access-code response never masquerades as an expired student login', async () => {
  const { api, request } = serviceWith()
  const pending = api.loadMemberCourseLibrary()
  await new Promise(setImmediate)
  request().success({ statusCode: 401, data: { error: 'Access code required' } })
  await assert.rejects(pending, /课程库暂时无法读取/)
  assert.match(await api.createLibraryCourseLaunchUrl(id), /[?&]library=/)
})

test('member courses page follows the design: cover cards, wrapped titles, member labels', async () => {
  const { page } = pageWith(async () => [
    { id, title: '氧化还原反应·概念辨析与电子转移分析', subject: '化学', grade: '高一', isMember: true, coverUrl: 'https://course.example/api/course-covers/' + 'c'.repeat(64) + '.jpg' },
    { id: 'b'.repeat(32), title: '三角函数', subject: '', grade: '', isMember: false, coverUrl: '' }
  ])
  await page.loadCourses()
  assert.deepEqual(page.data.visibleCourses.map(({ subtitle, priceLabel, tone }) => ({ subtitle, priceLabel, tone })), [
    { subtitle: '化学 · 高一 年级', priceLabel: '会员免费学', tone: 'coral' },
    { subtitle: '会员公共课程', priceLabel: '会员专享', tone: 'blue' }
  ])
  page.searchCourses({ detail: { value: '化学' } })
  assert.equal(page.data.visibleCourses.length, 1)
  page.clearSearch()
  assert.equal(page.data.visibleCourses.length, 2)

  const wxml = fs.readFileSync(path.join(__dirname, '../learning/library/index.wxml'), 'utf8')
  assert.match(wxml, /<image wx:if="\{\{item.coverUrl\}\}" class="member-course-cover-image" src="\{\{item.coverUrl\}\}"/)
  const css = fs.readFileSync(path.join(__dirname, '../learning/library/index.wxss'), 'utf8')
  const rule = css.slice(css.indexOf('.member-course-name {'), css.indexOf('}', css.indexOf('.member-course-name {')))
  assert.doesNotMatch(rule, /nowrap/)
  assert.match(rule, /-webkit-line-clamp: 3/)
})

test('member courses search bar hides after scrolling down and returns on scroll up', () => {
  const { page } = pageWith(async () => [])
  page.handleScroll({ detail: { scrollTop: 40 } })
  page.handleScroll({ detail: { scrollTop: 120 } })
  assert.equal(page.data.isSearchHidden, true)
  page.handleScroll({ detail: { scrollTop: 105 } })
  assert.equal(page.data.isSearchHidden, false)
})

// 「我的课程」→「课程库」：只列学生自己的课程（定制课程 + 学习计划课程），不是会员公共课（2026-09-24 用户反馈）。
function myLibraryWith(load) {
  let definition
  const navigations = []
  const timers = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../learning/library/index.js'), 'utf8'), {
    Page(page) { definition = page },
    require(name) {
      if (name.endsWith('/live-tab-service')) return { getMyCourseLibrary: load }
      if (name.endsWith('/identity')) return { loadMemberCourseLibrary() { throw new Error('member catalog must not be read') } }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/my-course-groups')) return require('../utils/my-course-groups')
      return { attachUiAssets() {}, openCustomCourseIntro() {} }
    },
    setTimeout(fn) { timers.push(fn); return timers.length }, clearTimeout() {},
    wx: {
      navigateTo(value) { navigations.push(value.url) },
      getWindowInfo: () => ({ windowWidth: 375, statusBarHeight: 20 }),
      getMenuButtonBoundingClientRect: () => ({ top: 24, height: 32 })
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ scope: 'mine' })
  return { page, navigations, timers }
}

const agentCard = { id: 'agent:stage-abc123', kind: 'agent', stageId: 'stage-abc123', title: '借出去的10要记账', subtitle: '定制课程 · 6 页', canLearn: true, isGenerating: false, progress: 100, coverUrl: 'https://course.example/api/course-covers/a.jpg' }
const planCard = { id: '42', kind: 'plan', title: '一次函数', meta: '数学', subtitle: '数学 · 待学习', coverUrl: '' }

test('my course library lists only the student\'s own courses and opens each the same way as 我的课程', async () => {
  const { page, navigations, timers } = myLibraryWith(async () => ({ courses: [agentCard, planCard], hasGenerating: false }))
  assert.deepEqual([page.data.mine, page.data.pageTitle], [true, '我的课程库'])
  await page.loadCourses()
  assert.deepEqual(page.data.visibleCourses.map((course) => [course.title, course.priceLabel]), [['借出去的10要记账', '定制课程'], ['一次函数', '学习计划']])
  assert.equal(timers.length, 0)
  page.searchCourses({ detail: { value: '数学' } })
  assert.deepEqual(page.data.visibleCourses.map((course) => course.id), ['42'])
  page.clearSearch()
  page.openCourse({ currentTarget: { dataset: { id: agentCard.id } } })
  page.openCourse({ currentTarget: { dataset: { id: '42' } } })
  assert.deepEqual(navigations, ['/learning/agent-course/index?stageId=stage-abc123', '/learning/course/index?courseInstanceId=42'])
})

test('my course library keeps refreshing while a course is being made, and shows an error (not an empty list) when the first read fails', async () => {
  let reply = { courses: [{ ...agentCard, canLearn: false, isGenerating: true, progress: 40 }], hasGenerating: true }
  const { page, timers } = myLibraryWith(async () => { if (reply instanceof Error) throw reply; return reply })
  await page.loadCourses()
  assert.equal(page.data.visibleCourses[0].priceLabel, '制作中 40%')
  assert.equal(timers.length, 1)
  reply = { courses: [agentCard], hasGenerating: false }
  await timers.pop()()
  assert.equal(page.data.visibleCourses[0].priceLabel, '定制课程')
  assert.equal(timers.length, 0)

  const failed = myLibraryWith(async () => { throw new Error('offline') }).page
  await failed.loadCourses()
  assert.deepEqual([failed.data.error, failed.data.loaded, failed.data.visibleCourses.length], ['offline', false, 0])
})
