const { loadGoalDiagnosis, goalDiagnosis, loadTeacherGoalDiagnosis } = require('../../services/identity')
const { getNavigationMetrics } = require('../../utils/navigation')
const { progressView, summaryView, stateText } = require('../../utils/goal-map')

// 按目标测评 + 目标导图（2026-10-10 用户规则）。
// 学生先定学习目标 → 课程服务把目标拆成几个大条件、落到真实知识点 → 边测边往下挖：做错或点「不会」就是卡点，
// 沿知识图谱把它的前置知识点拉进来接着测，直到挖到根上。学生看不到题量，只看到导图一点点长出来；
// 一轮最多 30 道（课程服务定），随时能「先到这里」，下次接着测。
// 老师从学生详情进来带 studentProfileId：只读看导图，不出题。
//
// 页面状态 view：loading（骨架）/ failed（第一次读取失败）/ no_goal / intro（开始前）/ subject（选学科）/
// planning（拆目标中）/ question（答题）/ preparing（下一题准备中）/ result（导图 + 结论）/ plan_failed

const POLL_MS = 2000
const POLL_LIMIT = 60

function errorText(error, fallback) {
  return (error && error.message) || fallback
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    view: 'loading',
    teacher: false,
    loadError: '',
    actionError: '',
    goal: null,
    goalChanged: false,
    subjects: [],
    pickedSubject: '',
    diagnosis: null,
    stateText: '',
    question: null,
    selected: '',
    submitting: false,
    progress: { total: 0, settled: 0, dots: [] },
    digHint: '',
    summary: null,
    showMapWhileTesting: false,
    busy: false
  },

  onLoad(options = {}) {
    this.setData(getNavigationMetrics())
    this._teacherStudent = options.studentProfileId ? String(options.studentProfileId) : ''
    this._autostart = options.autostart === '1'
    // 从「目标」tab 的历史目标点进来：直接看那一次
    this._viewId = /^[1-9][0-9]*$/.test(String(options.id || '')) ? Number(options.id) : 0
    this.setData({ teacher: Boolean(this._teacherStudent) })
    this.load()
  },

  onShow() {
    // 回到页面（比如去改了学习目标）：静默刷新，不回骨架
    if (this._loadedOnce && !this._teacherStudent && !this._viewId && ['intro', 'no_goal', 'result'].indexOf(this.data.view) >= 0) this.load()
    if (this._resumePoll) {
      this._resumePoll = false
      this.poll()
    }
  },

  onHide() {
    if (this._pollTimer) this._resumePoll = true
    this.stopPoll()
  },

  onUnload() {
    this.stopPoll()
  },

  onResize() {
    this.setData(getNavigationMetrics())
  },

  /* ---------------- 读取 ---------------- */

  async load() {
    if (this._loading) return
    this._loading = true
    try {
      if (this._teacherStudent) {
        const view = await loadTeacherGoalDiagnosis(this._teacherStudent)
        this.setData({ goal: view.goal, loadError: '' })
        if (view.diagnosis && view.diagnosis.map) this.showResult(view.diagnosis)
        else this.setData({ view: 'no_goal', diagnosis: view.diagnosis || null })
        return
      }
      if (this._viewId && !this._loadedOnce) {
        this._loadedOnce = true
        const [overview, past] = await Promise.all([loadGoalDiagnosis(), goalDiagnosis('read', { id: this._viewId })])
        this.setData({ goal: overview.goal, subjects: overview.subjects || [], loadError: '' })
        return this.applyDiagnosis(past)
      }
      const overview = await loadGoalDiagnosis()
      this._loadedOnce = true
      this.setData({ goal: overview.goal, goalChanged: Boolean(overview.goalChanged), subjects: overview.subjects || [], loadError: '' })
      const diagnosis = overview.diagnosis
      if (!overview.goal) {
        this.setData({ view: 'no_goal', diagnosis: diagnosis || null })
        return
      }
      const unfinished = diagnosis && !overview.goalChanged && ['planning', 'active'].indexOf(diagnosis.status) >= 0
      if (unfinished) return this.applyDiagnosis(await goalDiagnosis('read', { id: diagnosis.id }))
      if (diagnosis && !overview.goalChanged && diagnosis.status !== 'failed') {
        this.showResult(diagnosis)
        return
      }
      if (this._autostart) {
        this._autostart = false
        return this.start()
      }
      this.setData({ view: 'intro', diagnosis: diagnosis || null })
    } catch (error) {
      if (this._loadedOnce || this.data.view !== 'loading') {
        wx.showToast({ title: errorText(error, '暂时没有刷新成功'), icon: 'none' })
      } else {
        this.setData({ view: 'failed', loadError: errorText(error, '测评暂时无法打开，请稍后重试。') })
      }
    } finally {
      this._loading = false
    }
  },

  retryLoad() {
    this.setData({ view: 'loading', loadError: '' })
    this.load()
  },

  /* ---------------- 把课程服务的测评状态铺到页面上 ---------------- */

  applyDiagnosis(diagnosis) {
    if (!diagnosis) return
    const previous = this.data.question
    this.setData({ diagnosis, stateText: stateText(diagnosis), actionError: '' })
    if (diagnosis.status === 'planning') {
      this.setData({ view: 'planning', question: null })
      return this.poll()
    }
    if (diagnosis.status === 'failed') {
      this.stopPoll()
      return this.setData({ view: 'plan_failed', question: null })
    }
    if (diagnosis.status === 'active' && diagnosis.question) {
      this.stopPoll()
      const question = diagnosis.question
      const deeper = previous && question.depth > (previous.depth || 0)
      return this.setData({
        view: 'question',
        question,
        selected: '',
        progress: progressView(diagnosis.map),
        digHint: deeper ? '这里有点卡，我们往前找找原因' : question.depth > 0 ? '正在往前检查基础' : ''
      })
    }
    if (diagnosis.status === 'active') {
      this.setData({ view: 'preparing', question: null, progress: progressView(diagnosis.map) })
      return this.poll()
    }
    this.stopPoll()
    this.showResult(diagnosis)
  },

  showResult(diagnosis) {
    this.setData({
      view: 'result',
      diagnosis,
      stateText: stateText(diagnosis),
      question: null,
      summary: summaryView(diagnosis),
      showMapWhileTesting: false
    })
  },

  /* ---------------- 轮询：拆目标、模型出题都在后台 ---------------- */

  poll() {
    this.stopPoll()
    let count = 0
    const tick = async () => {
      this._pollTimer = null
      const id = this.data.diagnosis && this.data.diagnosis.id
      if (!id) return
      count += 1
      try {
        const next = await goalDiagnosis('read', { id })
        if (!this._pollAlive) return
        this.applyDiagnosis(next)
      } catch (error) {
        // 网络抖一下不打断，继续等
      }
      if (this._pollAlive && ['planning', 'preparing'].indexOf(this.data.view) >= 0) {
        if (count >= POLL_LIMIT) {
          this.stopPoll()
          this.setData({ actionError: '准备的时间有点长，可以先离开，稍后回来接着测。' })
          return
        }
        this._pollTimer = setTimeout(tick, POLL_MS)
      }
    }
    this._pollAlive = true
    this._pollTimer = setTimeout(tick, POLL_MS)
  },

  stopPoll() {
    this._pollAlive = false
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  /* ---------------- 开始 / 选学科 ---------------- */

  async start(options = {}) {
    if (this.data.busy) return
    this.setData({ busy: true, actionError: '' })
    try {
      const data = {}
      if (this.data.pickedSubject) data.subject = this.data.pickedSubject
      if (options.restart) data.restart = true
      this._lastQuestion = null
      this.applyDiagnosis(await goalDiagnosis('start', data))
    } catch (error) {
      if (error && error.code === 'SUBJECT_REQUIRED') this.setData({ view: 'subject' })
      else if (error && error.code === 'GOAL_REQUIRED') this.setData({ view: 'no_goal' })
      else this.setData({ actionError: errorText(error, '测评没有开始，请稍后重试。') })
    } finally {
      this.setData({ busy: false })
    }
  },

  handleStart() {
    this.start()
  },

  handleRestart() {
    wx.showModal({
      title: '重新测一次？',
      content: '按现在的学习目标重新拆解、重新测。这次的导图会保留在记录里。',
      confirmText: '重新测',
      success: (result) => {
        if (result && result.confirm) this.start({ restart: true })
      }
    })
  },

  pickSubject(event) {
    this.setData({ pickedSubject: String(event.currentTarget.dataset.code || '') })
  },

  confirmSubject() {
    if (!this.data.pickedSubject) return
    this.start()
  },

  openGoal() {
    wx.navigateTo({ url: '/learning/learning-goal/index' })
  },

  /* ---------------- 答题 ---------------- */

  chooseOption(event) {
    if (this.data.submitting) return
    this.setData({ selected: String(event.currentTarget.dataset.value || ''), actionError: '' })
  },

  submitChoice() {
    if (!this.data.selected) return
    this.submit({ choice: this.data.selected })
  },

  submitDontKnow() {
    this.submit({ dontKnow: true })
  },

  async submit(answer) {
    const { diagnosis, question } = this.data
    if (this.data.submitting || !diagnosis || !question) return
    this.setData({ submitting: true, actionError: '' })
    try {
      const next = await goalDiagnosis('answer', { id: diagnosis.id, token: question.token, ...answer })
      this.applyDiagnosis(next)
    } catch (error) {
      this.setData({ actionError: errorText(error, '答案没有提交成功，请再点一次。') })
    } finally {
      this.setData({ submitting: false })
    }
  },

  async pauseHere() {
    const diagnosis = this.data.diagnosis
    if (!diagnosis || this.data.busy) return
    this.setData({ busy: true })
    try {
      this.stopPoll()
      this.applyDiagnosis(await goalDiagnosis('pause', { id: diagnosis.id }))
    } catch (error) {
      this.setData({ actionError: errorText(error, '暂时没停下来，请再点一次。') })
    } finally {
      this.setData({ busy: false })
    }
  },

  async resumeTest() {
    const diagnosis = this.data.diagnosis
    if (!diagnosis || this.data.busy) return
    this.setData({ busy: true, actionError: '' })
    try {
      this.applyDiagnosis(await goalDiagnosis('resume', { id: diagnosis.id }))
    } catch (error) {
      this.setData({ actionError: errorText(error, '没有接上，请稍后重试。') })
    } finally {
      this.setData({ busy: false })
    }
  },

  toggleMapWhileTesting() {
    this.setData({ showMapWhileTesting: !this.data.showMapWhileTesting })
  },

  previewFigure(event) {
    const url = String(event.currentTarget.dataset.url || '')
    if (url) wx.previewImage({ urls: [url], current: url })
  },

  // 导图里点课程：学生进课程详情；老师进课程验收页（老师看学生的课在那里）
  openCourse(event) {
    const { stageId, state } = event.detail || {}
    if (!stageId) return
    if (this.data.teacher) return wx.navigateTo({ url: `/teacher/course-acceptance/index?stageId=${encodeURIComponent(stageId)}` })
    if (state !== 'ready') return
    wx.navigateTo({ url: `/learning/agent-course/index?stageId=${encodeURIComponent(stageId)}` })
  },

  handleBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/knowledge-universe/index' }) })
  }
})
