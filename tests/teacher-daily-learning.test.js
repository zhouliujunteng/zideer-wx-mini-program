// 老师「学习情况 › 今日学习」（2026-10-07）：老师每天进学生详情，看学生今天学了没有、学了什么；
// 今天学过的，点一下生成一段话（课程服务按今天的学习写），完整显示、点一下复制，单独发给学生。一天一段，可重新生成。
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const view = require('../utils/daily-learning-view')

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')

const STUDIED = {
  day: '2026-10-07',
  facts: {
    day: '2026-10-07',
    minutes: 95,
    checkedIn: true,
    plan: { done: 1, total: 2, tomorrow: ['《有理数的减法》第 2–4 页'] },
    recent: { studiedDays: 5, streakDays: 3, minutes: 200, daily: [] },
    studied: true,
    courses: [
      {
        stageId: 'stage-a', title: '有理数的加法', completedPages: 4, totalPages: 4, finishedToday: true, acceptance: 'passed', quiz: { correct: 4, total: 5 },
        pages: [{ page: 2, title: '数轴上的加法', kind: 'lecture' }, { page: 3, title: '同号相加', kind: 'lecture' }, { page: 4, title: '异号相加', kind: 'lecture' }, { page: 5, title: '小测', kind: 'quiz' }]
      },
      { stageId: 'stage-b', title: '有理数的减法', completedPages: 1, totalPages: 6, finishedToday: false, acceptance: null, quiz: null, pages: [{ page: 1, title: '减去一个数', kind: 'lecture' }] }
    ]
  },
  note: null
}
const IDLE = { day: '2026-10-07', facts: { day: '2026-10-07', minutes: 0, checkedIn: false, plan: null, studied: false, courses: [] }, note: null }
const NOTE = { text: '知夏，你今天把有理数的加法全部学完了，测验答对 4 道题。明天把减法接着学完，加油！', teacherName: '王老师', updatedAt: '2026-10-07T06:32:00Z', outdated: false }

test('card: date, time, pages and today tasks; each course says what was finished today and how it went', () => {
  const card = view.decorateDaily(STUDIED)
  assert.equal(card.dayText, '10月7日 周三')
  assert.equal(card.studied, true)
  assert.equal(card.checkedIn, true)
  assert.deepEqual(card.stats, [
    { label: '学习时长', value: '1小时35', unit: '分钟' },
    { label: '今天学完', value: '5', unit: '页' },
    { label: '今日任务', value: '1/2', unit: '项' }
  ])
  assert.equal(card.courses[0].line, '学完 4 页：数轴上的加法、同号相加、异号相加 等 4 页')
  assert.equal(card.courses[0].progress, '', '整门课学完不再写进度')
  assert.deepEqual(card.courses[0].tags.map((t) => t.text), ['测验 4/5', '整门课学完', '复述验收通过'])
  assert.equal(card.courses[1].line, '学完 1 页：减去一个数')
  assert.equal(card.courses[1].progress, '进度 1/6')
  assert.equal(card.onlyTime, false)
  assert.equal(card.note, null)
  assert.equal(card.recentText, '最近 7 天学了 5 天 · 连续 3 天 · 共 3小时20分钟')
  assert.equal(view.recentLabel({ studiedDays: 1, streakDays: 1, minutes: 12 }), '最近 7 天学了 1 天 · 共 12分钟', '连续不到 2 天不写')
  assert.equal(view.recentLabel(null), '')

  const withNote = view.decorateDaily({ ...STUDIED, note: { ...NOTE, outdated: true } })
  assert.deepEqual(withNote.note, { text: NOTE.text, meta: '王老师 · 14:32 生成', outdated: true })
  // 只有时长、没有学完新的一页
  const onlyTime = view.decorateDaily({ ...IDLE, facts: { ...IDLE.facts, minutes: 6, studied: true } })
  assert.equal(onlyTime.onlyTime, true)
  assert.deepEqual(onlyTime.stats.map((s) => s.label), ['学习时长', '今天学完'], '没排任务就不显示今日任务')
  assert.equal(view.minutesLabel(120).value, '2')
  assert.equal(view.minutesLabel(120).unit, '小时')
})

function loadDetailPage(service) {
  let definition
  const calls = { toasts: [], copied: [] }
  vm.runInNewContext(read('teacher/student-detail/index.js'), {
    Page(config) { definition = config },
    getCurrentPages: () => [{}, {}],
    console,
    setTimeout,
    clearTimeout,
    setInterval: () => 1,
    clearInterval: () => {},
    wx: {
      getWindowInfo: () => ({ windowWidth: 390, statusBarHeight: 44 }),
      getMenuButtonBoundingClientRect: () => ({ top: 48, height: 32 }),
      showToast: (options) => calls.toasts.push(options.title),
      setClipboardData: (options) => { calls.copied.push(options.data); if (options.success) options.success() },
      navigateTo() {}
    },
    require(name) {
      if (name.endsWith('/identity')) {
        return {
          loadTeacherStudentProfile: async () => ({ profile: { displayName: '林知夏', grade: 7 }, invites: [] }),
          loadTeacherStudentAgentCourses: async () => ({ courses: [] }),
          loadTeacherStudentAssessments: async () => [],
          loadTeacherLearningPreference: async () => ({ status: 'unset' }),
          ...service
        }
      }
      if (name.endsWith('/agent-invite-view')) return require('../services/agent-invite-view')
      if (name.endsWith('/ui-assets')) return { attachUiAssets() {} }
      if (name.endsWith('/study-plan-view')) return require('../utils/study-plan-view')
      if (name.endsWith('/daily-learning-view')) return view
      if (name.endsWith('/services/share-cover')) return { prepareShareCover() {}, shareWithCover: (page, options) => options }
      throw new Error(`Unexpected import ${name}`)
    }
  })
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)), setData(patch) { Object.assign(this.data, patch) } }
  page.onLoad({ studentProfileId: '31', tab: 'learning' })
  return { page, calls }
}

test('page: skeleton until the first reply, then studied / not studied; a first failure offers retry, a later one keeps the card', async () => {
  let reply = () => Promise.reject(new Error('今日学习暂时无法读取，请稍后重试。'))
  const { page } = loadDetailPage({ loadTeacherDailyLearning: () => reply() })
  assert.equal(page.data.dailyState, 'loading')
  await page.loadDaily()
  assert.equal(page.data.dailyState, 'failed')
  assert.equal(page.data.dailyError, '今日学习暂时无法读取，请稍后重试。')

  reply = async () => IDLE
  await page.loadDaily()
  assert.equal(page.data.dailyState, 'ready')
  assert.equal(page.data.daily.studied, false)

  reply = async () => STUDIED
  await page.loadDaily()
  assert.equal(page.data.daily.studied, true)
  reply = () => Promise.reject(new Error('网络不好'))
  await page.loadDaily()
  assert.equal(page.data.dailyState, 'ready', '刷新失败保留卡片')
  assert.equal(page.data.daily.courses.length, 2)
})

test('generate the message for the student, show it in full and copy it with one tap; not studied today asks to wait', async () => {
  const created = []
  let createReply = async () => ({ ...STUDIED, note: NOTE })
  const { page, calls } = loadDetailPage({
    loadTeacherDailyLearning: async () => STUDIED,
    createTeacherDailyNote: async (id) => { created.push(id); return createReply() }
  })
  await page.loadDaily()
  await page.handleDailyNote()
  assert.deepEqual(created, ['31'])
  assert.equal(page.data.daily.note.text, NOTE.text)
  assert.equal(page.data.dailyWriting, false)
  assert.ok(calls.toasts.includes('已生成，点一下就能复制'))
  page.copyDailyNote()
  assert.deepEqual(calls.copied, [NOTE.text])
  assert.ok(calls.toasts.includes('已复制，可以粘贴发给学生'))

  // 正在写的时候再点不重复生成
  let release
  createReply = () => new Promise((resolve) => { release = () => resolve({ ...STUDIED, note: NOTE }) })
  const first = page.handleDailyNote()
  await page.handleDailyNote()
  assert.equal(created.length, 2)
  release()
  await first

  createReply = async () => { throw Object.assign(new Error('学生今天还没有学习记录，学了之后再生成。'), { code: 'DAILY_NOT_STUDIED' }) }
  await page.handleDailyNote()
  assert.ok(calls.toasts.includes('学生今天还没有学习记录，学了之后再生成。'))
})

test('the card sits at the top of the learning tab: full text, copy on tap, generate button; not studied shows no button', () => {
  const wxml = read('teacher/student-detail/index.wxml')
  const learning = wxml.slice(wxml.indexOf("activeTab === 'learning'"))
  assert.ok(learning.indexOf('今日学习') < learning.indexOf('bindtap="openStudyPlan"'), '今日学习在学习安排入口上面')
  assert.match(learning, /bindtap="copyDailyNote"/)
  assert.match(learning, /bindtap="handleDailyNote"/)
  assert.match(learning, /发给学生的话/)
  assert.match(learning, /今天还没有学习/)
  // 那段话按今天的学习、结合整体情况写，卡片上写明依据
  assert.match(learning, /结合测评成绩、课程进度和最近 7 天/)
  assert.match(learning, /daily\.recentText/)
  const idle = learning.slice(learning.indexOf('今天还没有学习'), learning.indexOf('wx:else class="card daily-block daily-card"'))
  assert.doesNotMatch(idle, /handleDailyNote/)
  assert.doesNotMatch(read('teacher/student-detail/index.wxss'), /\.daily-note-text[^}]*line-clamp/)
})
