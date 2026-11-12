// 家长「学习报告」（2026-10-07）：老师给孩子出的学习成长报告家长同步看到、老师删掉就看不到；
// 服务号菜单「学习报告」推的卡片带 reportId 进来直接打开；「已定课程」打开学习页的「我的定制课程」。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const { groupGuardianReports } = require('../utils/guardian-report-view')
const parentReportView = require('../utils/parent-report-view')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)
const ID_C = 'c'.repeat(32)

const report = (extra = {}) => ({
  id: ID_A, studentProfileId: 501, studentName: '林知夏', teacherName: '王老师',
  createdAt: '2026-10-06T06:32:00Z', completedAt: '2026-10-06T06:33:10Z', fileSize: 1000,
  teacherNote: '知夏这一阶段进步明显。',
  summary: { subjects: [{ subject: '数学', score: 80, delta: 25 }], courseCount: 7, doneCourses: 4, newlyMastered: 8 },
  ...extra
})

test('grouping: one group per child with reports, children without reports listed as waiting', () => {
  const view = groupGuardianReports({
    students: [{ profileId: 501, name: '林知夏' }, { profileId: 502, name: '' }],
    reports: [report(), report({ id: ID_B, createdAt: '2026-10-01T02:00:00Z', completedAt: null })]
  }, new Date('2026-10-06T10:00:00Z'))
  assert.equal(view.groups.length, 1)
  assert.equal(view.groups[0].name, '林知夏')
  assert.deepEqual(view.groups[0].reports.map((r) => r.id), [ID_A, ID_B])
  assert.equal(view.groups[0].reports[0].timeText, '今天 14:33')
  assert.equal(view.groups[0].reports[0].byText, '王老师出的报告')
  assert.equal(view.groups[0].reports[0].note, '知夏这一阶段进步明显。')
  assert.deepEqual(view.waiting, ['孩子'])
  assert.equal(view.total, 2)
  assert.equal(view.hasStudents, true)
  assert.equal(groupGuardianReports({ students: [], reports: [] }).hasStudents, false)
})

function loadGuardianPage(service, { token = 'jwt', accountType = 'guardian', pages = 2 } = {}) {
  let definition
  const calls = { toasts: [], opened: [], navigations: [], logins: 0, downloads: [] }
  vm.runInNewContext(read('account/parent-reports/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => new Array(pages).fill({}),
    console,
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      openDocument: (options) => calls.opened.push(options.filePath),
      getFileSystemManager: () => ({ unlink() {} }),
      navigateTo: (options) => calls.navigations.push(options.url),
      switchTab: (options) => calls.navigations.push(options.url),
      navigateBack() {}
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          getStoredToken: () => token,
          accessOfError: (error) => (error && error.auth ? 'guest' : ''),
          loadGuardianParentReports: service.load,
          downloadGuardianParentReport: async (id) => { calls.downloads.push(id); return `/tmp/${id}.pdf` }
        }
      }
      if (name.endsWith('/access-gate')) return { openLogin: () => { calls.logins += 1 } }
      if (name.endsWith('/account-role')) return { readAccountType: () => accountType }
      if (name.endsWith('/guardian-report-view')) return { groupGuardianReports }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  return { page, calls }
}

test('guardian page: skeleton first, then reports; a service-account card opens its report directly', async () => {
  let resolve
  const { page, calls } = loadGuardianPage({ load: () => new Promise((r) => { resolve = r }) })
  page.onLoad({ reportId: ID_A })
  const loading = page.onShow()
  assert.equal(page.data.loadState, 'loading')
  resolve({ students: [{ profileId: 501, name: '林知夏' }], reports: [report()] })
  await loading
  await flush()
  assert.equal(page.data.loadState, 'ready')
  assert.equal(page.data.groups.length, 1)
  assert.deepEqual(calls.downloads, [ID_A])
  assert.deepEqual(calls.opened, [`/tmp/${ID_A}.pdf`])
  assert.equal(page.data.focusId, ID_A)
})

test('guardian page: a report the teacher deleted is announced as withdrawn, not opened', async () => {
  const { page, calls } = loadGuardianPage({ load: async () => ({ students: [{ profileId: 501, name: '林知夏' }], reports: [report()] }) })
  page.onLoad({ reportId: ID_C })
  await page.onShow()
  assert.deepEqual(calls.opened, [])
  assert.match(calls.toasts[0], /已被老师撤回/)
})

test('guardian page: guests see a login prompt; login errors fall back to it too', async () => {
  const guest = loadGuardianPage({ load: async () => { throw new Error('should not load') } }, { token: '' })
  guest.page.onLoad({})
  await guest.page.onShow()
  assert.equal(guest.page.data.loadState, 'guest')
  guest.page.handleLogin()
  assert.equal(guest.calls.logins, 1)

  const expired = loadGuardianPage({ load: async () => { const e = new Error('x'); e.code = 'LOGIN_REQUIRED'; throw e } })
  expired.page.onLoad({})
  await expired.page.onShow()
  assert.equal(expired.page.data.loadState, 'guest')
})

test('guardian page: no children → bind prompt (students are told reports go to parents); first failure → retry', async () => {
  const empty = loadGuardianPage({ load: async () => ({ students: [], reports: [] }) })
  empty.page.onLoad({})
  await empty.page.onShow()
  assert.equal(empty.page.data.hasStudents, false)
  assert.equal(empty.page.data.isStudent, false)
  empty.page.handleBindStudent()
  assert.deepEqual(empty.calls.navigations, ['/account/bind-student/index'])

  const student = loadGuardianPage({ load: async () => ({ students: [], reports: [] }) }, { accountType: 'student' })
  student.page.onLoad({})
  await student.page.onShow()
  assert.equal(student.page.data.isStudent, true)

  const failed = loadGuardianPage({ load: async () => { throw new Error('学习报告暂时无法读取，请稍后重试。') } })
  failed.page.onLoad({})
  await failed.page.onShow()
  assert.equal(failed.page.data.loadState, 'failed')
  assert.equal(failed.page.data.loadError, '学习报告暂时无法读取，请稍后重试。')
  const wxml = read('account/parent-reports/index.wxml')
  assert.match(wxml, /bindtap="load"/)
  assert.match(wxml, /class="sk /)
})

test('guardian page is registered, guest-browsable, and listed for guardians under 我的 › 知鹿服务', () => {
  const app = JSON.parse(read('app.json'))
  const account = app.subpackages.find((pkg) => pkg.root === 'account')
  assert.ok(account.pages.includes('parent-reports/index'))
  const guestRoutes = read('services/identity.js').match(/const GUEST_BROWSABLE_ROUTES = \[([\s\S]*?)\]/)[1]
  assert.match(guestRoutes, /'account\/parent-reports\/index'/)
  assert.match(read('pages/me/index.js'), /'学习报告': '\/account\/parent-reports\/index'/)
  const { withGuardianReportItem } = loadLiveTabHelpers()
  const groups = withGuardianReportItem([{ title: '知鹿服务', items: [{ title: '推广伙伴' }] }])
  const titles = (list) => JSON.stringify(list[0].items.map((item) => item.title))
  assert.equal(titles(groups), '["学习报告","推广伙伴"]')
  assert.equal(titles(withGuardianReportItem(groups)), '["学习报告","推广伙伴"]')
})

function loadLiveTabHelpers() {
  const source = read('services/live-tab-service.js')
  const start = source.indexOf('const GUARDIAN_REPORT_ITEM')
  const end = source.indexOf('module.exports', start)
  const sandbox = { module: { exports: {} } }
  vm.runInNewContext(`${source.slice(start, end)}\nmodule.exports = { withGuardianReportItem }`, sandbox)
  return sandbox.module.exports
}

test('teacher can delete a report after confirming; the list reloads', async () => {
  let definition
  let reports = [{ id: ID_A, status: 'ready', createdAt: '2026-10-06T06:32:00Z', teacherName: '王老师', fileSize: 10, summary: null }]
  const deleted = []
  const modals = []
  vm.runInNewContext(read('teacher/parent-report/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast() {},
      showModal: (options) => { modals.push(options); options.success({ confirm: true }) },
      getFileSystemManager: () => ({ unlink() {} })
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          loadTeacherParentReports: async () => ({ reports }),
          createTeacherParentReport: async () => ({}),
          downloadTeacherParentReport: async () => new Promise(() => {}),
          deleteTeacherParentReport: async (studentId, id) => { deleted.push([studentId, id]); reports = [] }
        }
      }
      if (name.endsWith('/parent-report-view')) return parentReportView
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31' })
  await page.onShow()
  page.handleDelete({ currentTarget: { dataset: { id: ID_A } } })
  await flush()
  await flush()
  assert.match(modals[0].content, /家长在小程序和服务号里都看不到/)
  assert.deepEqual(deleted, [['31', ID_A]])
  assert.deepEqual(page.data.reports, [])
  assert.equal(page.data.workingId, '')
  assert.match(read('teacher/parent-report/index.wxml'), /bindtap="handleDelete"/)
  page.onUnload()
})

test('service-account menu 「已定课程」 opens 我的课程 › 我的定制课程', () => {
  const source = read('pages/learning/index.js')
  assert.match(source, /getApp\(\)\.globalData\.learningTab = String\(options\.tab\)/)
  assert.match(source, /this\.applyRequestedCourseTab\(app\)/)
  assert.match(read('app.js'), /options\.path === 'pages\/learning\/index' && options\.query && options\.query\.tab/)
  assert.ok(require('../utils/my-course-groups').MY_COURSE_TABS.some((tab) => tab.id === 'custom'))
})
