const test = require('node:test')
const assert = require('node:assert/strict')
const vm = require('node:vm')
const fs = require('node:fs')
const path = require('node:path')
const paymentSwitchStub = require('./helpers/payment-switch-stub')

const ready = { status: 'ready', teacher: { id: '1', name: '王老师', teacherNo: 'T102938' },
  students: [{ bindingId: '7', studentProfileId: '9', name: '小明', grade: 5, publicId: '123456', boundAt: '2026-09-19T08:00:00Z' }] }

function loadPage(file, workspace) {
  let definition
  const navigations = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {
    Page(p) { definition = p }, getApp: () => ({}), getCurrentPages: () => [{}, {}],
    wx: { showToast() {}, navigateTo: o => navigations.push(o.url), navigateBack() { navigations.push('back') }, stopPullDownRefresh() {} },
    require(name) {
      if (name.endsWith('/identity')) return {
        loadCurrentMembership: async () => ({ status: 'inactive', eligible: false }),
        loadCurrentServiceContacts: async () => ({ status: 'no_active_contacts', contacts: [] }),
        loadCurrentTeacherWorkspace: workspace,
        hasSession: () => true
      }
      if (name.endsWith('/utils/access-gate')) return require('../utils/access-gate')
      if (name.endsWith('/membership-view')) return require('../services/membership-view')
      if (name.endsWith('/customer-service')) return { openCustomerServiceChat: async () => {} }
      if (name.endsWith('/mock-service')) return { getMeModel: () => ({ profile: {}, accountSummary: [] }) }
      if (name.endsWith('/live-tab-service')) return { getLiveMeModel: async () => ({ profile: { name: 'x' } }), withGuardianQuickActions: (actions) => actions }
      if (name.endsWith('/utils/account-role')) return require('../utils/account-role')
      if (name.endsWith('/utils/grade-name')) return require('../utils/grade-name')
      if (name.endsWith('/utils/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/fit-font')) return require('../utils/fit-font')
      if (name.endsWith('/utils/mini-program-version')) return require('../utils/mini-program-version')
      if (name.endsWith('/payment-switch')) return paymentSwitchStub({ navigateTo() {}, redirectTo() {} })
      throw Error('Unexpected import ' + name)
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  return { page, navigations }
}

test('me page shows the teacher entry only to an active teacher', async () => {
  const { page, navigations } = loadPage('../pages/me/index.js', async () => ready)
  await page.onShow()
  assert.equal(JSON.stringify(page.data.teacherEntry), JSON.stringify({ name: '王老师', description: '负责 1 名学生' }))
  page.openTeacherWorkspace()
  assert.equal(navigations[0], '/teacher/workspace/index')
})

test('me page hides the teacher entry for ordinary users and on read failure', async () => {
  const plain = loadPage('../pages/me/index.js', async () => ({ status: 'not_teacher', teacher: null, students: [] }))
  await plain.page.onShow()
  assert.equal(plain.page.data.teacherEntry, null)
  const failing = loadPage('../pages/me/index.js', async () => { throw Error('down') })
  await failing.page.onShow()
  assert.equal(failing.page.data.teacherEntry, null)
})

test('me page drops the teacher entry after the teacher is disabled', async () => {
  let result = ready
  const { page } = loadPage('../pages/me/index.js', async () => result)
  await page.onShow()
  assert.ok(page.data.teacherEntry)
  page.onHide()
  result = { status: 'not_teacher', teacher: null, students: [] }
  await page.onShow()
  assert.equal(page.data.teacherEntry, null)
})

test('teacher workspace lists assigned students and blocks non-teachers', async () => {
  const teacher = loadPage('../teacher/workspace/index.js', async () => ready)
  await teacher.page.loadPage()
  assert.deepEqual(teacher.navigations, [])
  assert.equal(teacher.page.data.students[0].gradeText, '小学五年级')
  assert.match(teacher.page.data.students[0].boundText, /9月19日$/)
  assert.equal(teacher.page.data.visibleStudents.length, 1)

  teacher.page.handleSearch({ detail: { value: '1234' } })
  assert.equal(teacher.page.data.visibleStudents.length, 1)
  teacher.page.handleSearch({ detail: { value: '小红' } })
  assert.equal(teacher.page.data.visibleStudents.length, 0)
  teacher.page.clearSearch()
  assert.equal(teacher.page.data.visibleStudents.length, 1)

  const outsider = loadPage('../teacher/workspace/index.js', async () => ({ status: 'not_teacher', teacher: null, students: [] }))
  await outsider.page.loadPage()
  // 不是老师（按路径直接打开或刚被停用）不留说明页，直接退回上一页
  assert.deepEqual(outsider.navigations, ['back'])
  assert.equal(outsider.page.data.loaded, false)
  assert.equal(outsider.page.data.students.length, 0)
})

function loadAddPage(workspace, bind) {
  let definition
  const toasts = []
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../teacher/add-student/index.js'), 'utf8'), {
    Page(p) { definition = p }, getCurrentPages: () => [{}, {}],
    wx: { showToast: o => toasts.push(o.title), navigateBack() {} },
    require(name) {
      if (name.endsWith('/identity')) return { loadCurrentTeacherWorkspace: workspace, bindStudentAsCurrentTeacher: bind }
      if (name.endsWith('/ui-assets')) return { attachUiAssets: () => Promise.resolve({}) }
      if (name.endsWith('/utils/screen')) return require('../utils/screen')
      if (name.endsWith('/utils/fit-font')) return require('../utils/fit-font')
      if (name.endsWith('/utils/grade-name')) return require('../utils/grade-name')
      if (name.endsWith('/utils/study-plan-view')) return require('../utils/study-plan-view')
      throw Error('Unexpected import ' + name)
    }
  })
  const page = { ...definition, data: { ...definition.data }, setData(patch) { Object.assign(this.data, patch) } }
  return { page, toasts }
}

test('add-student page blocks non-teachers before any binding call', async () => {
  let calls = 0
  const { page } = loadAddPage(async () => ({ status: 'not_teacher', teacher: null, students: [] }), async () => { calls++ })
  await page.checkTeacher()
  assert.equal(page.data.notTeacher, true)
  page.setData({ code: '123456' })
  await page.submit()
  assert.equal(calls, 0)
})

test('add-student page binds a six-digit ID for an active teacher', async () => {
  const codes = []
  const { page, toasts } = loadAddPage(async () => ready, async code => { codes.push(code); return { status: 'bound', student: { name: '小红', grade: 4, publicId: code } } })
  await page.checkTeacher()
  assert.equal(page.data.notTeacher, false)
  page.handleInput({ detail: { value: '12a34567' } })
  assert.equal(page.data.code, '123456')
  await page.submit()
  assert.deepEqual(codes, ['123456'])
  assert.equal(page.data.added.name, '小红')
  assert.equal(page.data.added.gradeText, '小学四年级')
  // 头像、档案编号取自重新读到的工作台名单，用来显示头像、进学生详情
  assert.equal(page.data.added.studentProfileId, '9')
  assert.equal(page.data.added.alreadyBound, false)
  assert.equal(page.data.code, '')
  assert.equal(toasts[0], '已添加')
})

test('add-student page shows a student already on the roster as a card, not an error', async () => {
  const withAvatar = { ...ready, students: [{ ...ready.students[0], avatarUrl: 'https://example.com/a.jpeg' }] }
  const { page, toasts } = loadAddPage(async () => withAvatar, async () => ({ status: 'already_bound', student: null }))
  await page.checkTeacher()
  page.setData({ code: '123456' })
  await page.submit()
  assert.equal(page.data.error, '')
  assert.equal(page.data.added.alreadyBound, true)
  assert.equal(page.data.added.name, '小明')
  assert.equal(page.data.added.avatarUrl, 'https://example.com/a.jpeg')
  assert.deepEqual(toasts, [])
})

test('add-student page shows backend refusals and short IDs', async () => {
  const { page } = loadAddPage(async () => ready, async () => { throw Object.assign(Error('没有找到这个用户 ID 对应的学生，请核对后重试。'), { code: 'code_not_found' }) })
  await page.checkTeacher()
  page.setData({ code: '123' })
  await page.submit()
  assert.equal(page.data.error, '请输入学生的 6 位用户 ID')
  page.setData({ code: '654321' })
  await page.submit()
  assert.match(page.data.error, /没有找到/)
  assert.equal(page.data.submitting, false)
})
