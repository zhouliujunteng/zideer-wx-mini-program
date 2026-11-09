// 老师「家长学习报告」页（2026-10-06）：学生详情 → 家长学习报告。
// 生成新报告（课程服务后台生成，约 1 分钟）→ 列表轮询到「已生成」→ 预览、发给家长（微信聊天文件）；每份都留档。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const view = require('../utils/parent-report-view')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const flush = () => new Promise((resolve) => setImmediate(resolve))
const ID_A = 'a'.repeat(32)
const ID_B = 'b'.repeat(32)

const ready = (extra = {}) => ({
  id: ID_A, status: 'ready', createdAt: '2026-10-06T06:32:00Z', completedAt: '2026-10-06T06:33:10Z', teacherName: '王老师',
  fileName: '林知夏-学习成长报告-20261006.pdf', fileSize: 1081550, teacherNote: '知夏这一阶段进步明显。', studentNote: '知夏，你这周把有理数的计算拿下了，真棒！',
  summary: { subjects: [{ subject: '数学', score: 80, delta: 25 }, { subject: '英语', score: 72, delta: null }], courseCount: 7, doneCourses: 4, newlyMastered: 8 },
  errorText: null, ...extra
})

function loadReportPage(service, wxExtra = {}) {
  let definition
  const calls = { toasts: [], modals: [], opened: [], shared: [], unlinked: [], navigations: [], copied: [] }
  vm.runInNewContext(read('teacher/parent-report/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      showModal: (options) => {
        calls.modals.push(options)
        if (options.success) options.success({ confirm: true, cancel: false })
      },
      openDocument: (options) => { calls.opened.push(options); if (options.success) options.success() },
      setClipboardData: (options) => { calls.copied.push(options.data); if (options.success) options.success() },
      shareFileMessage: (options) => { calls.shared.push(options) },
      getFileSystemManager: () => ({ unlink: (options) => calls.unlinked.push(options.filePath) }),
      navigateTo: (options) => calls.navigations.push(options.url),
      navigateBack() {},
      redirectTo() {},
      ...wxExtra
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/parent-report-view')) return view
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31', name: encodeURIComponent('林知夏') })
  return { page, calls }
}

// ---------- 列表显示 ----------

test('report cards: time, who made it, size, score chips with gains, teacher note; failures carry the reason', () => {
  const now = new Date('2026-10-06T10:00:00Z')
  const card = view.decorateReport(ready(), now)
  assert.equal(card.timeText, '今天 14:32')
  assert.equal(card.byText, '王老师出的报告')
  assert.equal(card.sizeText, '1.0MB')
  assert.deepEqual(card.chips.map((c) => c.text), ['数学 80 分 ↑25', '英语 72 分', '定制课程 7 节 · 学完 4 节', '新掌握 8 个知识点'])
  assert.equal(card.parentNote, '知夏这一阶段进步明显。')
  assert.equal(card.studentNote, '知夏，你这周把有理数的计算拿下了，真棒！')
  const failed = view.decorateReport(ready({ status: 'failed', errorText: '这个学生还没有测评和课程', summary: null }), now)
  assert.equal(failed.statusLabel, '生成失败')
  assert.equal(failed.errorText, '这个学生还没有测评和课程')
  assert.deepEqual(failed.chips, [])
  assert.equal(view.timeLabel('2026-10-05T01:05:00Z', now), '昨天 09:05')
  assert.equal(view.timeLabel('2026-09-30T01:05:00Z', now), '9月30日 09:05')
})

// ---------- 页面 ----------

test('skeleton until the first reply; the first failure shows retry instead of an empty list', async () => {
  let fail = true
  const { page } = loadReportPage({ loadTeacherParentReports: async () => { if (fail) throw new Error('报告记录暂时无法读取，请稍后重试。'); return { reports: [] } } })
  assert.equal(page.data.loadState, 'loading')
  await page.onShow()
  assert.equal(page.data.loadState, 'failed')
  assert.equal(page.data.loadError, '报告记录暂时无法读取，请稍后重试。')
  fail = false
  await page.load()
  assert.equal(page.data.loadState, 'ready')
  assert.deepEqual(page.data.reports, [])
  page.onUnload()
})

test('generate: starts on the course service, polls while generating, says when it is ready and fetches the file ahead', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let reports = []
  const created = []
  const downloads = []
  const { page, calls } = loadReportPage({
    loadTeacherParentReports: async () => ({ reports }),
    createTeacherParentReport: async (id) => { created.push(id); reports = [ready({ status: 'generating', fileName: null, summary: null, teacherNote: null })]; return { report: reports[0] } },
    downloadTeacherParentReport: async (id, reportId) => { downloads.push([id, reportId]); return `wxfile://usr/parent-report-${reportId}.pdf` }
  })
  await page.onShow()
  await page.handleCreate()
  assert.deepEqual(created, ['31'])
  assert.ok(calls.toasts.includes('开始生成，大约 1 分钟'))
  assert.equal(page.data.generating, true)
  // 生成中再点：不重复开
  await page.handleCreate()
  assert.equal(created.length, 1)
  assert.ok(calls.toasts.includes('这份报告还在生成，请稍等'))

  reports = [ready()]
  t.mock.timers.tick(4000)
  await flush()
  await flush()
  assert.equal(page.data.generating, false)
  assert.equal(page.data.reports[0].statusLabel, '已生成')
  assert.ok(calls.toasts.includes('报告已生成'))
  assert.deepEqual(downloads, [['31', ID_A]], '刚生成好的那份先下载好')
  page.onUnload()
  assert.deepEqual(calls.unlinked, [`wxfile://usr/parent-report-${ID_A}.pdf`], '离开页面删掉本地的 PDF')
})

test('send to parent: a fetched file goes straight to a WeChat file message with the report name', async () => {
  const { page, calls } = loadReportPage({
    loadTeacherParentReports: async () => ({ reports: [ready()] }),
    downloadTeacherParentReport: async (id, reportId) => `wxfile://usr/parent-report-${reportId}.pdf`
  })
  await page.onShow()
  await flush()
  await page.handleShare({ currentTarget: { dataset: { id: ID_A } } })
  assert.deepEqual(calls.shared.map((s) => [s.filePath, s.fileName]), [[`wxfile://usr/parent-report-${ID_A}.pdf`, '林知夏-学习成长报告-20261006.pdf']])
  page.onUnload()
})

test('send to parent after downloading: when WeChat wants a fresh tap, ask once more; without file messages, open it to forward', async () => {
  let gesture = true
  const service = {
    loadTeacherParentReports: async () => ({ reports: [ready(), ready({ id: ID_B, createdAt: '2026-10-05T06:32:00Z' })] }),
    downloadTeacherParentReport: async (id, reportId) => { if (reportId === ID_A) throw new Error('先不预下载'); return `wxfile://usr/parent-report-${reportId}.pdf` }
  }
  const { page, calls } = loadReportPage(service, {
    shareFileMessage(options) {
      calls.shared.push(options)
      if (gesture) { gesture = false; options.fail({ errMsg: 'shareFileMessage:fail can only be invoked by user TAP gesture.' }) }
    }
  })
  await page.onShow()
  await page.handleShare({ currentTarget: { dataset: { id: ID_B } } })
  assert.equal(calls.modals.length, 1)
  assert.equal(calls.modals[0].confirmText, '发送')
  assert.equal(calls.shared.length, 2, '点「发送」后再发一次')
  page.onUnload()

  const plain = loadReportPage({ ...service, downloadTeacherParentReport: async (id, reportId) => `wxfile://usr/parent-report-${reportId}.pdf` }, { shareFileMessage: undefined })
  await plain.page.onShow()
  await flush()
  await plain.page.handleShare({ currentTarget: { dataset: { id: ID_B } } })
  assert.equal(plain.calls.opened.length, 1)
  assert.equal(plain.calls.opened[0].showMenu, true)
  assert.ok(plain.calls.toasts.includes('点右上角「…」把报告转发给家长'))
  plain.page.onUnload()
})

test('preview downloads once and opens the PDF with the forward menu; download errors become a toast', async () => {
  let fail = false
  let count = 0
  const { page, calls } = loadReportPage({
    loadTeacherParentReports: async () => ({ reports: [ready({ id: ID_B })] }),
    downloadTeacherParentReport: async (id, reportId) => { count += 1; if (fail) throw new Error('这份报告的文件已经不在了，请重新生成。'); return `wxfile://usr/parent-report-${reportId}.pdf` }
  })
  await page.onShow()
  await flush()
  await page.handlePreview({ currentTarget: { dataset: { id: ID_B } } })
  await page.handlePreview({ currentTarget: { dataset: { id: ID_B } } })
  assert.equal(count, 1, '预下载过就不再下载')
  assert.equal(calls.opened.length, 2)
  assert.equal(calls.opened[0].fileType, 'pdf')
  page.onUnload()

  fail = true
  const second = loadReportPage({
    loadTeacherParentReports: async () => ({ reports: [] }),
    downloadTeacherParentReport: async () => { throw new Error('这份报告的文件已经不在了，请重新生成。') }
  })
  await second.page.onShow()
  second.page._reports = view.decorateReports([ready()])
  await second.page.handlePreview({ currentTarget: { dataset: { id: ID_A } } })
  assert.ok(second.calls.toasts.includes('这份报告的文件已经不在了，请重新生成。'))
  assert.equal(second.page.data.workingId, '')
  second.page.onUnload()
})

test('student detail opens the report page for this student', () => {
  const wxml = read('teacher/student-detail/index.wxml')
  assert.match(wxml, /bindtap="openParentReport"/)
  assert.match(read('teacher/student-detail/index.js'), /\/teacher\/parent-report\/index\?studentProfileId=/)
  assert.match(read('app.json'), /"parent-report\/index"/)
})

test('two messages, one for the parent and one for the student, show in full and copy with one tap', async () => {
  const { page, calls } = loadReportPage({
    loadTeacherParentReports: async () => ({ reports: [ready()] }),
    downloadTeacherParentReport: async (id, reportId) => `wxfile://usr/parent-report-${reportId}.pdf`
  })
  await page.onShow()
  await flush()
  page.handleCopy({ currentTarget: { dataset: { id: ID_A, kind: 'parent' } } })
  page.handleCopy({ currentTarget: { dataset: { id: ID_A, kind: 'student' } } })
  assert.deepEqual(calls.copied, ['知夏这一阶段进步明显。', '知夏，你这周把有理数的计算拿下了，真棒！'])
  assert.ok(calls.toasts.includes('已复制，可以粘贴发给家长'))
  assert.ok(calls.toasts.includes('已复制，可以粘贴发给学生'))
  const wxml = read('teacher/parent-report/index.wxml')
  assert.match(wxml, /发给家长的话/)
  assert.match(wxml, /发给学生的话/)
  // 完整显示：不再只显示三行
  assert.doesNotMatch(read('teacher/parent-report/index.wxss'), /line-clamp:\s*3/)
  // 生成新报告是标题旁的小按钮，不再是一整张说明卡
  assert.match(wxml, /class="create-button/)
  assert.doesNotMatch(wxml, /intro-card/)
  page.onUnload()
})

// ---------- 推送家长（2026-10-08）----------

test('push to parents: confirms, pushes through the course service, then shows who got it', async () => {
  const pushes = []
  let pushed = null
  const { page, calls } = loadReportPage({
    loadTeacherParentReports: async () => ({ reports: [ready({ push: pushed })] }),
    pushTeacherParentReport: async (id, reportId) => {
      pushes.push([id, reportId])
      pushed = { guardians: 2, sent: 1, waiting: 1, failed: 0 }
      return pushed
    }
  })
  await page.onShow()
  await flush()
  assert.equal(page.data.reports[0].pushed, false)
  await page.handlePush({ currentTarget: { dataset: { id: ID_A } } })
  await flush()
  assert.deepEqual(pushes, [['31', ID_A]])
  assert.equal(calls.modals[0].title, '推送给家长？')
  assert.equal(calls.modals[1].title, '已推送')
  assert.equal(calls.modals[1].content, '已推送 1 位家长；1 位家长还没关注服务号，关注后 24 小时内补发')
  assert.equal(page.data.reports[0].pushed, true)
  assert.equal(page.data.reports[0].pushText, calls.modals[1].content)
  // 已推送过：不再推，只提示结果
  page.handlePush({ currentTarget: { dataset: { id: ID_A } } })
  assert.equal(pushes.length, 1)
  assert.match(read('teacher/parent-report/index.wxml'), /bindtap="handlePush"[^>]*>[^<]*推送家长/)
  page.onUnload()
})

test('push view: nothing yet, all sent, and failures', () => {
  assert.deepEqual(view.pushView(null), { pushed: false, pushText: '' })
  assert.deepEqual(view.pushView({ guardians: 1, sent: 1, waiting: 0, failed: 0 }), { pushed: true, pushText: '已推送 1 位家长' })
  assert.deepEqual(view.pushView({ guardians: 2, sent: 1, waiting: 0, failed: 1 }), { pushed: false, pushText: '已推送 1 位家长；1 位没推送成功' })
  assert.equal(view.decorateReport(ready({ status: 'failed', push: { guardians: 1, sent: 1 } })).pushText, '')
})

test('push button hides when the service-account switch is off', async () => {
  const { page } = loadReportPage({ loadTeacherParentReports: async () => ({ reports: [ready()], pushEnabled: false }) })
  await page.onShow()
  await flush()
  assert.equal(page.data.pushEnabled, false)
  assert.match(read('teacher/parent-report/index.wxml'), /wx:if="\{\{pushEnabled\}\}"[^>]*bindtap="handlePush"/)
  page.onUnload()
})
