const { loadLearningGoal, saveLearningGoal, createLearningGoal } = require('../../services/identity')
const { getNavigationMetrics } = require('../../utils/navigation')
const {
  normalizeGoalView,
  decorateDirections,
  toggleDirection,
  deadlineText,
  goalPreviewLines,
  deadlineRange,
  goalSpecificity
} = require('../../utils/learning-goal')

// 学习宇宙 › 我的学习目标（2026-10-07 用户需求）：目标方向 + 具体目标 + 希望完成时间，学生自己填。
// 诊断会议的 AI 老师定制课程前和学习偏好一起先看，每一页课生成时也会带上（课程服务 lib/course/learning-goal.ts）。
// 第一次读到之前只画骨架；目标是学生自己编辑的，读不到也不挡着：用内置方向照样能填，顶部提示可重新读取。

const SKELETON_CARDS = [[104, 116, 92], [240], [180]]

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    state: 'loading',
    readFailed: false,
    skeletonCards: SKELETON_CARDS,
    directions: [],
    goal: '',
    goalLength: 0,
    goalLimit: 200,
    goalPlaceholder: '',
    deadline: '',
    deadlineLeft: '',
    deadlineStart: '',
    deadlineEnd: '',
    preview: [],
    // 「把目标写具体」三条引导（2026-11-11 闯关第一关）
    specific: goalSpecificity('', ''),
    dirty: false,
    saving: false,
    saveError: '',
    // 读到的是已经保存过的内容：没改动时按钮显示「已保存」
    hasSaved: false,
    // 新增目标（学习页左上角「新增学习目标」进来，2026-11-13）：表单从空白开始，保存时新建一个目标并切过去
    creating: false
  },

  onLoad(options) {
    this._creating = !!(options && options.mode === 'new')
    this.setData({ ...getNavigationMetrics(), creating: this._creating })
    this.load()
  },

  onResize() {
    this.setData(getNavigationMetrics())
  },

  async load() {
    if (this._loading) return
    this._loading = true
    try {
      const loaded = normalizeGoalView(await loadLearningGoal())
      // 新增目标：只用读到的方向目录和今天，表单是空的
      const view = this._creating ? { ...loaded, status: 'empty', direction: '', goal: '', deadline: '' } : loaded
      if (this.data.state === 'ready' && this.data.dirty) {
        // 读失败后已经动手改了：不冲掉正在改的，只换上真实的「已保存」
        this._saved = { direction: view.direction, goal: view.goal, deadline: view.deadline }
        this.setData({ readFailed: false })
        this.refresh()
      } else {
        this.applySaved(view)
        this.setData({ readFailed: false })
      }
    } catch (error) {
      if (this.data.state === 'ready' && !this.data.readFailed) return
      if (this.data.state !== 'ready') this.applySaved(normalizeGoalView(null))
      this.setData({ readFailed: true })
    } finally {
      this._loading = false
    }
  },

  retryRead() {
    this.load()
  },

  applySaved(view) {
    this._catalog = view.catalog
    this._today = view.today
    this._saved = { direction: view.direction, goal: view.goal, deadline: view.deadline }
    this._direction = view.direction
    const range = deadlineRange(view.today, view.catalog.maxDays)
    this.setData({
      state: 'ready',
      hasSaved: view.status === 'set',
      goalLimit: view.catalog.goalLimit,
      goalPlaceholder: view.catalog.goalPlaceholder,
      goal: view.goal,
      // 已经过了的完成时间照样显示，学生改一个新的；选择器只能选今天以后
      deadline: view.deadline,
      deadlineStart: range.start,
      deadlineEnd: range.end,
      saveError: ''
    })
    this.refresh()
  },

  refresh() {
    const current = { direction: this._direction || '', goal: String(this.data.goal || ''), deadline: this.data.deadline }
    const saved = this._saved || { direction: '', goal: '', deadline: '' }
    this.setData({
      directions: decorateDirections(this._catalog, current.direction),
      goalLength: Array.from(current.goal).length,
      deadlineLeft: deadlineText(current.deadline, this._today),
      preview: goalPreviewLines(this._catalog, current, this._today),
      specific: goalSpecificity(current.goal, current.deadline),
      dirty: saved.direction !== current.direction || saved.goal.trim() !== current.goal.trim() || saved.deadline !== current.deadline
    })
  },

  handleDirectionTap(event) {
    if (this.data.saving || !this._catalog) return
    this._direction = toggleDirection(this._direction || '', String(event.currentTarget.dataset.id || ''))
    this.setData({ saveError: '' })
    this.refresh()
  },

  handleGoalInput(event) {
    if (this.data.saving) return
    this.setData({ goal: String((event.detail && event.detail.value) || ''), saveError: '' })
    this.refresh()
  },

  handleDeadlineChange(event) {
    if (this.data.saving) return
    this.setData({ deadline: String((event.detail && event.detail.value) || ''), saveError: '' })
    this.refresh()
  },

  clearDeadline() {
    if (this.data.saving) return
    this.setData({ deadline: '', saveError: '' })
    this.refresh()
  },

  async save() {
    if (this.data.saving || !this.data.dirty) return
    // 目标写得太笼统：先问一句要不要再写具体（只提示一次，选「就这样保存」照常保存）
    const specific = goalSpecificity(this.data.goal, this.data.deadline)
    if (specific.vague && this._vagueAsked !== this.data.goal) {
      this._vagueAsked = this.data.goal
      wx.showModal({
        title: '目标再写具体一点？',
        content: `${specific.tip}。写具体了，老师才知道先帮你补哪里。`,
        confirmText: '再改改',
        cancelText: '就这样存',
        success: (result) => { if (result && result.cancel) this.save() }
      })
      return
    }
    if (this.data.deadline && this.data.deadline < this._today) {
      this.setData({ saveError: '完成时间已经过了，换一个今天或以后的日期，或者清除它。' })
      return
    }
    if (this._creating) return this.create()
    this.setData({ saving: true, saveError: '' })
    try {
      const view = normalizeGoalView(await saveLearningGoal({ direction: this._direction, goal: this.data.goal, deadline: this.data.deadline }))
      this.applySaved(view)
      this.setData({ readFailed: false })
      // 按目标测评（2026-10-10 用户规则）：先定目标，再围绕目标出题
      if (String(view.goal || '').trim()) this.offerGoalDiagnosis()
      else wx.showToast({ title: '已保存', icon: 'success' })
    } catch (error) {
      this.setData({ saveError: (error && error.message) || '学习目标没有保存成功，请稍后重试。' })
    } finally {
      this.setData({ saving: false })
    }
  },

  // 新建目标并切过去：学习页换成这个目标的闯关路径，从入门三关开始
  async create() {
    if (!String(this.data.goal || '').trim()) {
      this.setData({ saveError: '写一下这个新目标具体想达到什么，再建好它。' })
      return
    }
    this.setData({ saving: true, saveError: '' })
    try {
      await createLearningGoal({ direction: this._direction, goal: this.data.goal, deadline: this.data.deadline })
      this._saved = { direction: this._direction || '', goal: String(this.data.goal || ''), deadline: this.data.deadline }
      this.setData({ dirty: false })
      wx.showModal({
        title: '新目标建好了',
        content: '学习页已经换成这个目标的闯关路径。现在围绕它测一轮？做错的地方会往前找原因，老师开诊断会议时会参考。',
        confirmText: '开始测评',
        cancelText: '去学习页',
        success: (result) => {
          if (result && result.confirm) wx.redirectTo({ url: '/learning/goal-diagnosis/index?autostart=1' })
          else wx.switchTab({ url: '/pages/learning/index' })
        }
      })
    } catch (error) {
      this.setData({ saveError: (error && error.message) || '新目标没有建成功，请稍后重试。' })
    } finally {
      this.setData({ saving: false })
    }
  },

  offerGoalDiagnosis() {
    wx.showModal({
      title: '目标已保存',
      content: '现在围绕这个目标测一轮？做错的地方会往前找原因，最后生成一张目标导图。随时可以先停下。',
      confirmText: '开始测评',
      cancelText: '稍后',
      success: (result) => {
        if (result && result.confirm) wx.navigateTo({ url: '/learning/goal-diagnosis/index?autostart=1' })
      }
    })
  },

  handleBack() {
    const leave = () => wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/knowledge-universe/index' }) })
    if (!this.data.dirty || this.data.state !== 'ready') return leave()
    wx.showModal({
      title: this._creating ? '新目标还没建好' : '还没有保存',
      content: this._creating ? '这个新目标还没建好，离开后不会保留。' : '这次写的目标还没保存，离开后不会生效。',
      confirmText: '保存',
      cancelText: '不保存',
      success: (result) => {
        if (result && result.confirm) this.save().then(() => { if (!this.data.dirty) leave() })
        else if (result && result.cancel) leave()
      }
    })
  }
})
