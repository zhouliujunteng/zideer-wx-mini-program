const { loadTeacherStudyReminder, createTeacherStudyReminder } = require('../../services/identity')
const { dayDiff, monthDay, weekday } = require('../../utils/study-plan-view')

// 老师工作台「没完成任务」→ 学生（2026-10-09 用户规则）。
// 学生前几天老师排的学习任务没学完，课程服务已经把没学完的页带到今天（今天休息就是下一个学习日）。
// 这里列出没学完的任务，打开时没有今天的那段话就自动生成：哪天哪门课没学完、已经重新安排到今天、今天一定记得学完。
// 老师点一下复制，在微信里单独发给学生；一个学生一天一段，可重新生成（课程服务 lib/course/study-reminder.ts）。

function errorText(error, fallback) {
  return error && error.message ? error.message : fallback
}

// 「昨天」「前天」「10月6日」
function pastDayText(day, today) {
  const offset = dayDiff(today, day)
  if (offset === -1) return '昨天'
  if (offset === -2) return '前天'
  return monthDay(day)
}

function carryText(facts) {
  if (facts.carryDay === facts.today) return '这些没学完的内容已经带到今天，排在今天任务的最前面。'
  return `今天是休息日，这些没学完的内容已经带到${monthDay(facts.carryDay)} ${weekday(facts.carryDay)}，排在那天任务的最前面。`
}

function timeText(iso) {
  const time = Date.parse(iso || '')
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function noteView(note) {
  if (!note) return null
  const parts = [[note.teacherName, timeText(note.updatedAt)].filter(Boolean).join(' '), '点击复制']
  if (note.outdated) parts.push('学生之后又学了一些，可以重新生成')
  return { text: note.text, meta: parts.filter(Boolean).join(' · ') }
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    studentName: '',
    loadState: 'loading',
    loadError: '',
    refreshing: false,
    summaryText: '',
    missed: [],
    carryText: '',
    note: null,
    writing: false,
    writeError: ''
  },

  onLoad(options = {}) {
    this.studentProfileId = String(options.studentProfileId || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + Math.max(4, menuButton.top - statusBarHeight) * 2
    let studentName = ''
    try {
      studentName = options.name ? decodeURIComponent(String(options.name)).slice(0, 20) : ''
    } catch (error) {
      studentName = ''
    }
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18, studentName })
  },

  onShow() {
    return this.load()
  },

  onUnload() {
    this._unloaded = true
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/teacher/workspace/index' })
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.load()
    this.setData({ refreshing: false })
  },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    if (this.data.loadState === 'failed') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const result = await loadTeacherStudyReminder(this.studentProfileId)
      if (requestId !== this._requestId || this._unloaded) return
      this.apply(result)
      // 打开时还没有今天的那段话：直接生成
      if (this.data.missed.length && !result.note && !this._autoWritten) {
        this._autoWritten = true
        this.write()
      }
    } catch (error) {
      if (requestId !== this._requestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: errorText(error, '刷新失败，请稍后重试'), icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: errorText(error, '请稍后重试。') })
    }
  },

  apply(result = {}) {
    const facts = result.facts || {}
    const today = String(facts.today || result.today || '')
    const missed = (Array.isArray(facts.missed) ? facts.missed : []).map((task, index) => ({
      key: `${task.day}-${index}`,
      title: task.title || '定制课程',
      dayText: pastDayText(task.day, today),
      meta: [
        task.pageLabel,
        Number(task.completed) ? `已学 ${task.completed}/${task.total} 页` : '还没开始',
        Number(task.minutes) ? `约 ${task.minutes} 分钟` : ''
      ].filter(Boolean).join(' · ')
    }))
    const minutes = (facts.missed || []).reduce((total, task) => total + (Number(task.minutes) || 0), 0)
    this.setData({
      loadState: 'ready',
      loadError: '',
      missed,
      summaryText: missed.length ? `${missed.length} 项任务没学完${minutes ? `，约 ${minutes} 分钟` : ''}` : '前几天的任务都学完了',
      carryText: missed.length ? carryText({ today, carryDay: String(facts.carryDay || today) }) : '',
      note: this.data.writing ? this.data.note : noteView(result.note)
    })
  },

  async write() {
    if (this.data.writing) return
    this.setData({ writing: true, writeError: '' })
    try {
      const result = await createTeacherStudyReminder(this.studentProfileId)
      if (this._unloaded) return
      this.setData({ writing: false })
      this.apply(result)
    } catch (error) {
      if (this._unloaded) return
      this.setData({ writing: false, writeError: errorText(error, '这段话暂时没有生成，请稍后重试。') })
      // 学生已经补完了：刷新成最新
      if (error && error.code === 'NOTHING_MISSED') this.load()
    }
  },

  regenerate() {
    return this.write()
  },

  copyNote() {
    const note = this.data.note
    if (!note || !note.text) return
    wx.setClipboardData({ data: note.text, success: () => wx.showToast({ title: '已复制，去微信发给学生', icon: 'none' }) })
  },

  openPlan() {
    const query = `studentProfileId=${encodeURIComponent(this.studentProfileId)}&name=${encodeURIComponent(this.data.studentName)}`
    wx.navigateTo({ url: `/teacher/study-plan/index?${query}` })
  }
})
