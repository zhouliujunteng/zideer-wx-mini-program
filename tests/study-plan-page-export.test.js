// 老师「学习安排」页（更新日志 1.0.3）：
// 1. 点「自动排课」后页面里显示进度条（不再用系统 loading）：请求期间渐近走向 90%、到不了 100%，
//    返回成功后走满 100% 再收起、弹结果；失败直接收起照原样提示；排课期间不能重复点。
// 2. 排好后把今天起的安排导出成竖版长图（2d 画布），用微信分享图片菜单发到学习群；不支持时存相册。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const view = require('../utils/study-plan-view')
const poster = require('../teacher/study-plan/plan-poster')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const TODAY = '2026-10-06'
const flush = () => new Promise((resolve) => setImmediate(resolve))

// node 的假时钟一次 tick 只跑已经到点的那一批，链式 setTimeout 要一小步一小步推
function advance(t, ms, step = 100) {
  for (let passed = 0; passed < ms; passed += step) t.mock.timers.tick(step)
}

// 记录画了什么的画布上下文：汉字和全角符号按 1 个字号宽，数字、字母、空格等按 0.55 个
function recordingContext() {
  const texts = []
  const noop = () => {}
  const target = {
    font: '',
    textAlign: 'left',
    measureText(text) {
      const size = Number((/(\d+(?:\.\d+)?)px/.exec(this.font) || [])[1]) || 10
      return { width: Array.from(String(text)).reduce((sum, char) => sum + (char.codePointAt(0) < 0x2000 ? size * 0.55 : size), 0) }
    },
    fillText(text, x, y) { texts.push({ text, x, y, font: this.font, align: this.textAlign, width: this.measureText(text).width }) },
    createLinearGradient: () => ({ addColorStop: noop })
  }
  const ctx = new Proxy(target, {
    get: (object, key) => (key in object ? object[key] : noop),
    set: (object, key, value) => { object[key] = value; return true }
  })
  return { ctx, texts }
}

const task = (extra = {}) => ({
  id: 't-aaaaaaaa', day: TODAY, stageId: 'stage-a', title: '两位数退位减法', pageLabel: '第 1–3 页', minutes: 9,
  completed: 0, total: 3, progress: 0, state: 'not_started', overdue: false, source: 'auto', level: 1, subject: '数学', ...extra
})

function planView(extra = {}) {
  return {
    today: TODAY,
    revision: 2,
    plan: {
      dailyMinutes: 30,
      startDay: TODAY,
      lastDay: '2026-10-07',
      overdueCount: 0,
      days: [
        { day: TODAY, minutes: 24, tasks: [task(), task({ id: 't-bbbbbbbb', stageId: 'stage-b', title: '三位数退位减法', pageLabel: '全部 4 页', minutes: 15 })] },
        { day: '2026-10-07', minutes: 12, tasks: [task({ id: 't-cccccccc', day: '2026-10-07', stageId: 'stage-c', title: '认识钟表' })] }
      ]
    },
    courses: [
      { stageId: 'stage-a', title: '两位数退位减法', learningState: 'not_started', completedPages: 0, totalPages: 3, remainingMinutes: 9, scheduled: true },
      { stageId: 'stage-b', title: '三位数退位减法', learningState: 'not_started', completedPages: 0, totalPages: 4, remainingMinutes: 15, scheduled: true },
      { stageId: 'stage-c', title: '认识钟表', learningState: 'not_started', completedPages: 0, totalPages: 3, remainingMinutes: 12, scheduled: true }
    ],
    unscheduledCount: 0,
    ...extra
  }
}

function loadPlanPage(service, { wxExtra = {}, confirm = true, saveError = null } = {}) {
  let definition
  const recording = recordingContext()
  const canvas = { width: 0, height: 0, getContext: () => recording.ctx }
  const calls = { toasts: [], modals: [], loading: 0, queries: [], exports: [], shareMenus: [], saved: [], settings: 0 }
  vm.runInNewContext(read('teacher/study-plan/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    // 现取全局的：开了假时钟的用例里就是假时钟
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id),
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      showModal: (options) => {
        calls.modals.push(options)
        if (options.success) options.success({ confirm, cancel: !confirm })
      },
      showLoading: () => { calls.loading += 1 },
      hideLoading() {},
      navigateTo() {},
      navigateBack() {},
      redirectTo() {},
      createSelectorQuery() {
        const query = {
          in: () => query,
          select: (selector) => { calls.queries.push(selector); return query },
          fields: () => query,
          exec: (callback) => callback([{ node: canvas }])
        }
        return query
      },
      canvasToTempFilePath(options) {
        calls.exports.push({ canvas: options.canvas, width: options.width, height: options.height, destWidth: options.destWidth, destHeight: options.destHeight })
        options.success({ tempFilePath: 'wxfile://study-plan.png' })
      },
      showShareImageMenu: (options) => calls.shareMenus.push(options.path),
      saveImageToPhotosAlbum(options) {
        calls.saved.push(options.filePath)
        if (saveError) options.fail({ errMsg: saveError })
        else options.success()
      },
      openSetting: () => { calls.settings += 1 },
      ...wxExtra
    },
    require(name) {
      if (name.endsWith('/identity')) return service
      if (name.endsWith('/study-plan-view')) return view
      if (name === './plan-poster') return poster
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31', name: encodeURIComponent('小鹿') })
  return { page, calls, canvas, recording }
}

const autoResult = { taskCount: 3, dayCount: 2, firstDay: TODAY, lastDay: '2026-10-07', basis: 'ai', unscheduledCount: 0 }

// ---------- 排课进度条 ----------

test('auto scheduling shows an in-page progress bar that creeps toward 90% and never reaches 100% while waiting', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  const updates = []
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => planView(),
    updateTeacherStudyPlan: (...args) => { updates.push(args); return new Promise((resolve) => { release = resolve }) }
  })
  await page.onShow()
  const running = page.handleAuto()
  await flush()
  assert.equal(updates.length, 1)
  assert.equal(calls.loading, 0, '不再用系统 loading')
  assert.equal(page.data.progressVisible, true)
  assert.equal(page.data.busy, true)
  const first = page.data.progressPercent
  assert.ok(first > 0 && first < 100, `starts low: ${first}`)
  assert.equal(page.data.progressStage, 0)
  assert.deepEqual([...page.data.progressSteps], ['读取学生的课程', '判断先后顺序', '排进每一天'])

  // 排课期间再点不会重复请求
  await page.handleAuto()
  assert.equal(updates.length, 1)

  advance(t, 5000)
  const later = page.data.progressPercent
  assert.ok(later > first && later < 90, `creeps forward: ${later}`)
  assert.equal(page.data.progressStage, 1)
  advance(t, 120000)
  assert.equal(page.data.progressPercent, 90)
  assert.equal(page.data.progressStage, 2)
  // 只有「重新排课？」那个确认框，结果还没弹
  assert.equal(calls.modals.length, 1)

  release({ ...planView(), revision: 3, result: autoResult })
  await flush()
  assert.equal(page.data.progressPercent, 100)
  assert.equal(page.data.progressStage, 3)
  assert.equal(page.data.progressVisible, true)
  assert.equal(page.data.revision, 2, '走满之后才换上新安排')
  assert.equal(calls.modals.length, 1)

  advance(t, 1000)
  await flush()
  assert.equal(page.data.revision, 3)
  assert.equal(page.data.progressClosing, true)
  advance(t, 1000)
  await flush()
  await running
  assert.equal(page.data.progressVisible, false)
  assert.equal(page.data.busy, false)
  assert.equal(calls.modals.length, 2)
  assert.match(calls.modals[1].content, /排好了 3 项学习任务/)
  assert.match(calls.modals[1].content, /点「导出图片」发到学习群/)
})

test('a failed auto scheduling closes the progress bar at once and shows the error as before', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let reads = 0
  let fail
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => { reads += 1; return planView() },
    updateTeacherStudyPlan: () => new Promise((resolve, reject) => { fail = reject })
  })
  await page.onShow()
  const running = page.handleAuto()
  await flush()
  advance(t, 3000)
  assert.equal(page.data.progressVisible, true)
  assert.ok(page.data.progressPercent < 100)
  fail(Object.assign(new Error('学习安排刚被更新过，已刷新到最新，请再操作一次。'), { code: 'PLAN_CHANGED' }))
  await running
  await flush()
  assert.equal(page.data.progressVisible, false)
  assert.equal(page.data.progressPercent, 0)
  assert.equal(page.data.busy, false)
  assert.deepEqual(calls.toasts, ['学习安排刚被更新过，已刷新到最新，请再操作一次。'])
  // 别人刚改过：照原逻辑刷新到最新
  assert.equal(reads, 2)
  // 收起后计时器也停了
  advance(t, 5000)
  assert.equal(page.data.progressPercent, 0)
})

test('leaving the page mid-scheduling stops the progress timer and shows nothing afterwards', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let release
  const { page, calls } = loadPlanPage({
    loadTeacherStudyPlan: async () => planView({ plan: null }),
    updateTeacherStudyPlan: () => new Promise((resolve) => { release = resolve })
  })
  await page.onShow()
  page.selectMinutes({ currentTarget: { dataset: { minutes: 45 } } })
  const running = page.handleAuto()
  await flush()
  advance(t, 1000)
  const percent = page.data.progressPercent
  page.onUnload()
  advance(t, 10000)
  assert.equal(page.data.progressPercent, percent)
  release({ ...planView(), revision: 3, result: autoResult })
  await running
  assert.equal(calls.modals.length, 0)
})

test('the template draws the progress card in theme orange instead of the system loading toast', () => {
  const wxml = read('teacher/study-plan/index.wxml')
  assert.match(wxml, /wx:if="\{\{progressVisible\}\}" class="progress-layer[^"]*" catchtap="stopTap" catchtouchmove="stopTap"/)
  assert.match(wxml, /class="progress-fill" style="width: \{\{progressPercent\}\}%;"/)
  assert.match(wxml, /wx:for="\{\{progressSteps\}\}"/)
  assert.match(wxml, /\{\{progressPercent === 100 \? '排好了' : '正在排课'\}\}/)
  const wxss = read('teacher/study-plan/index.wxss')
  assert.match(wxss, /\.progress-fill \{[^}]*#FD7C02/)
  assert.doesNotMatch(read('teacher/study-plan/index.js'), /showLoading/)
})

// ---------- 导出排课图片 ----------

test('exporting draws the plan on the off-screen 2d canvas and opens the share-image menu', async () => {
  const { page, calls, canvas, recording } = loadPlanPage({ loadTeacherStudyPlan: async () => planView() })
  await page.onShow()
  await page.handleExport()
  assert.deepEqual(calls.queries, ['#planExportCanvas'])
  assert.deepEqual(calls.shareMenus, ['wxfile://study-plan.png'])
  assert.equal(calls.saved.length, 0)
  assert.equal(page.data.exporting, false)
  // 短安排按 3 倍导出，位图尺寸与导出尺寸一致
  assert.equal(canvas.width, poster.POSTER_WIDTH * 3)
  assert.deepEqual([calls.exports[0].canvas, calls.exports[0].width, calls.exports[0].height], [canvas, canvas.width, canvas.height])
  assert.equal(calls.exports[0].destHeight, canvas.height)

  const drawn = recording.texts.map((item) => item.text)
  for (const expected of ['知鹿学习', '小鹿的学习安排', '每天 30 分钟 · 共 2 天 · 3 项学习任务', '10月6日 周二 至 10月7日 周三',
    '10月6日 周二', '共 24 分钟', '两位数退位减法', '第 1–3 页 · 约 9 分钟', '三位数退位减法', '全部 4 页 · 约 15 分钟', '10月7日 周三', '认识钟表']) {
    assert.ok(drawn.includes(expected), `draws ${expected}`)
  }
  assert.ok(!drawn.some((text) => /今天|明天/.test(text)), '图里只写绝对日期')

  // 同一份安排再导出不重画
  await page.handleExport()
  assert.equal(calls.exports.length, 1)
  assert.deepEqual(calls.shareMenus, ['wxfile://study-plan.png', 'wxfile://study-plan.png'])

  const wxml = read('teacher/study-plan/index.wxml')
  assert.match(wxml, /<canvas type="2d" id="planExportCanvas" class="plan-export-canvas"/)
  assert.match(wxml, /wx:if="\{\{hasPlan && days.length\}\}" class="export-button[^"]*" bindtap="handleExport"/)
  assert.match(read('teacher/study-plan/index.wxss'), /\.plan-export-canvas \{ position: fixed; top: -9999px; left: -9999px;/)
})

test('without any scheduled task there is nothing to export', async () => {
  const { page, calls } = loadPlanPage({ loadTeacherStudyPlan: async () => planView({ plan: null }) })
  await page.onShow()
  await page.handleExport()
  assert.deepEqual(calls.toasts, ['还没有排好的学习任务，先自动排课'])
  assert.equal(calls.queries.length, 0)
  assert.equal(calls.shareMenus.length, 0)

  // 有安排但今天起一条任务也没有，同样不能导出
  const empty = loadPlanPage({ loadTeacherStudyPlan: async () => planView({ plan: { ...planView().plan, days: [] } }) })
  await empty.page.onShow()
  await empty.page.handleExport()
  assert.equal(empty.calls.shareMenus.length, 0)
  assert.equal(empty.calls.toasts.length, 1)
})

test('when the share-image menu is missing the image is saved to the album, and a denied album asks for the setting', async () => {
  const saved = loadPlanPage({ loadTeacherStudyPlan: async () => planView() }, { wxExtra: { showShareImageMenu: undefined } })
  await saved.page.onShow()
  await saved.page.handleExport()
  assert.deepEqual(saved.calls.saved, ['wxfile://study-plan.png'])
  assert.deepEqual(saved.calls.toasts, ['已保存到相册，可以发到学习群'])

  const denied = loadPlanPage({ loadTeacherStudyPlan: async () => planView() }, { wxExtra: { showShareImageMenu: undefined }, saveError: 'saveImageToPhotosAlbum:fail auth deny' })
  await denied.page.onShow()
  await denied.page.handleExport()
  assert.equal(denied.calls.modals.length, 1)
  assert.equal(denied.calls.modals[0].title, '需要相册权限')
  assert.equal(denied.calls.settings, 1)

  // 老师自己取消：什么也不提示
  const cancelled = loadPlanPage({ loadTeacherStudyPlan: async () => planView() }, { wxExtra: { showShareImageMenu: undefined }, saveError: 'saveImageToPhotosAlbum:fail cancel' })
  await cancelled.page.onShow()
  await cancelled.page.handleExport()
  assert.equal(cancelled.calls.modals.length, 0)
  assert.equal(cancelled.calls.toasts.length, 0)

  // 分享菜单调起失败（非取消）也退回存相册；取消就算了
  const menuFailed = loadPlanPage({ loadTeacherStudyPlan: async () => planView() }, { wxExtra: { showShareImageMenu: (options) => options.fail({ errMsg: 'showShareImageMenu:fail unknown' }) } })
  await menuFailed.page.onShow()
  await menuFailed.page.handleExport()
  assert.deepEqual(menuFailed.calls.saved, ['wxfile://study-plan.png'])
  const menuCancelled = loadPlanPage({ loadTeacherStudyPlan: async () => planView() }, { wxExtra: { showShareImageMenu: (options) => options.fail({ errMsg: 'showShareImageMenu:fail cancel' }) } })
  await menuCancelled.page.onShow()
  await menuCancelled.page.handleExport()
  assert.equal(menuCancelled.calls.saved.length, 0)
})

test('exporting is blocked while scheduling is running', async () => {
  const { page, calls } = loadPlanPage({ loadTeacherStudyPlan: async () => planView() })
  await page.onShow()
  page.setData({ busy: true })
  await page.handleExport()
  assert.equal(calls.queries.length, 0)
  assert.equal(calls.shareMenus.length, 0)
})

// ---------- 排课图片的版面 ----------

test('fitText keeps text that fits and cuts long text to the width with an ellipsis', () => {
  const { ctx } = recordingContext()
  ctx.font = '700 10px sans-serif'
  assert.equal(poster.fitText(ctx, '两位数退位减法', 70), '两位数退位减法')
  assert.equal(poster.fitText(ctx, '两位数退位减法', 60), '两位数退位…')
  assert.ok(ctx.measureText(poster.fitText(ctx, '一'.repeat(40), 123)).width <= 123)
  // 截断处的分隔符不留在省略号前
  assert.equal(poster.fitText(ctx, '第 1 页 · 约 9 分钟', 70), '第 1 页…')
  assert.equal(poster.fitText(ctx, '', 50), '')
})

test('a busy day lists the first tasks and ends with 等 N 项', () => {
  const tasks = Array.from({ length: 8 }, (_, index) => task({ id: `t-${index}`, title: `第 ${index + 1} 门课` }))
  const built = poster.buildPlanPoster({ studentName: '小鹿', plan: { dailyMinutes: 120, days: [{ day: TODAY, minutes: 118, tasks }] } })
  assert.equal(built.cards.length, 1)
  assert.equal(built.cards[0].tasks.length, poster.MAX_TASKS_PER_DAY)
  assert.equal(built.cards[0].moreText, '…等 8 项')
  assert.equal(built.cards[0].minutesText, '共 1 小时 58 分钟')
  assert.equal(built.summary, '每天 2 小时 · 共 1 天 · 8 项学习任务')
  assert.equal(built.range, '10月6日 周二')
  assert.equal(built.moreDaysText, '')
  assert.equal(built.scale, 3)
  // 补学、学完的任务在说明里标出来
  const marked = poster.buildPlanPoster({ plan: { dailyMinutes: 30, days: [{ day: TODAY, minutes: 9, tasks: [task({ overdue: true }), task({ state: 'done', pageLabel: '' })] }] } })
  assert.equal(marked.title, '每日学习安排')
  assert.deepEqual(marked.cards[0].tasks.map((item) => [item.meta, item.tone]), [['第 1–3 页 · 约 9 分钟 · 补学', 'overdue'], ['约 9 分钟 · 已学完', 'done']])
  assert.equal(poster.buildPlanPoster({ plan: { dailyMinutes: 30, days: [] } }), null)
})

test('a long plan stops at the canvas limit, says 等 N 天 and every line stays inside the image', () => {
  const days = Array.from({ length: 40 }, (_, index) => ({
    day: view.addDays(TODAY, index),
    minutes: 45,
    tasks: [task({ title: '一元二次方程的根与系数关系（韦达定理）以及它在综合题里的各种用法' }), task({ title: '二次函数的图像与性质' }), task({ title: '相似三角形' })]
  }))
  const built = poster.buildPlanPoster({ studentName: '名字特别特别特别长的一位同学', plan: { dailyMinutes: 45, days } })
  assert.ok(built.cards.length > 3 && built.cards.length < 40, `${built.cards.length} days drawn`)
  assert.equal(built.moreDaysText, '…等 40 天')
  assert.ok(built.height * built.scale <= poster.MAX_PIXELS, 'bitmap height within the limit')
  assert.ok(built.scale >= 2 && built.scale <= 3)
  assert.equal(built.range, '10月6日 周二 至 11月14日 周六')

  const { ctx, texts } = recordingContext()
  poster.drawPlanPoster(ctx, built)
  for (const item of texts) {
    const left = item.align === 'center' ? item.x - item.width / 2 : item.align === 'right' ? item.x - item.width : item.x
    assert.ok(left >= 0 && left + item.width <= built.width, `"${item.text}" fits horizontally`)
    assert.ok(item.y > 0 && item.y < built.height, `"${item.text}" fits vertically`)
  }
  const drawn = texts.map((item) => item.text)
  assert.ok(drawn.some((text) => /^一元二次方程.*…$/.test(text)), 'long course titles are cut with an ellipsis')
  assert.ok(drawn.includes(built.moreDaysText))
  assert.equal(drawn[drawn.length - 1], '知鹿学习')
})
