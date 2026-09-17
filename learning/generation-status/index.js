const { loadCurrentLearningPlans, createCurrentCourseGenerationQuote, confirmCurrentCourseGeneration, prepareCourseOutlineReview, loadCourseOutline } = require('../../services/identity')
const { courseGenerationState, courseCreditState, canRetryCourseGeneration } = require('../../utils/course-state')

function creditsText(value) {
  if (value === null || value === undefined) return '积分结算信息将在报价后显示'
  return `预计 ${Math.round(Number(value))} 积分`
}

function creditsRange(settlement, fallback) {
  if (settlement && settlement.estimatedLowerCredits !== null && settlement.estimatedLowerCredits !== undefined) {
    return `预计 ${Math.round(Number(settlement.estimatedLowerCredits))}-${Math.round(Number(settlement.estimatedUpperCredits))} 积分`
  }
  return creditsText(fallback)
}

Page({
  data: { loading: true, failed: false, starting: false, quoting: false, quote: null, result: null, outlineReady: false },

  onLoad(options) {
    this.planItemId = String(options.planItemId || '')
    this.courseInstanceId = String(options.courseInstanceId || '')
    this.quoteKey = ''
    this.confirmKey = ''
  },

  onShow() {
    this._active = true
    this._lifecycle = (this._lifecycle || 0) + 1
    this.setData({ starting: false, quoting: false })
    return this.loadPage()
  },

  onHide() {
    this._active = false
    this._lifecycle = (this._lifecycle || 0) + 1
    this._loadVersion = (this._loadVersion || 0) + 1
    this.stopPolling()
  },

  onUnload() { this.onHide() },

  stopPolling() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  schedulePolling() {
    this.stopPolling()
    const result = this.data.result
    if (!this._active || this.data.failed || !result || result.canLaunch) return
    if (result.canPoll) {
      this._pollTimer = setTimeout(() => this.loadPage({ silent: true }), 5000)
    }
  },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage(options = {}) {
    this.stopPolling()
    const version = this._loadVersion = (this._loadVersion || 0) + 1
    this.setData({ loading: options.silent !== true, failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      if (version !== this._loadVersion || !this._active) return
      const plan = (data.plans || []).find(plan => (plan.items || []).some(entry => String(entry.id) === this.planItemId))
      const item = plan && (plan.items || []).find(entry => String(entry.id) === this.planItemId)
      const courses = item && (item.courseInstances || []).slice().sort((a, b) => Number(b.id) - Number(a.id)) || []
      let course = courses.find((entry) => !this.courseInstanceId || String(entry.id) === this.courseInstanceId)
      if (!item || (this.courseInstanceId && !course)) {
        this.setData({ result: null })
        return
      }
      if (course && ['failed', 'cancelled', 'voided_credit_limit'].includes(course.status) && courses[0] !== course) {
        course = courses[0]
        this.courseInstanceId = String(course.id)
        this.clearQuote()
      }
      const generationJob = course && course.generationJob || item.generationJob || null
      const state = courseGenerationState(course, generationJob, item.status)
      const planInactive = plan.status && plan.status !== 'active'
      const canRetryGeneration = !planInactive && item.status === 'available' && courses.length > 0 && courses.every(canRetryCourseGeneration)
      if (canRetryGeneration) {
        state.label = course.status === 'voided_credit_limit' ? '上次课程已作废' : '上次生成已结束'
        state.detail = '上次生成已结束，冻结积分已退回。可在当前任务重新获取报价并生成课程。'
      }
      if (planInactive && !state.canLaunch) {
        state.canPoll = false
        state.label = plan.status === 'paused' ? '学习计划已暂停' : '学习计划不在执行中'
        state.detail = '可返回学习计划选择其他任务，或创建新的学习计划。'
        state.tone = 'pending'
      }
      const settlement = course && course.creditSettlement || null
      const creditState = courseCreditState(settlement)
      this.setData({
        result: {
          taskTitle: item.topicName || '学习任务',
          subject: item.subjectName || '学习计划',
          ...state,
          title: state.label,
          copy: state.detail,
          credits: creditsRange(settlement, item.estimatedCredits),
          settlementNote: creditState ? creditState.note : '课程按实际用量结算积分，报价时会显示本节结算上限。',
          canRetryGeneration: Boolean(canRetryGeneration),
          canStartGeneration: Boolean(canRetryGeneration || (!planInactive && !course && !generationJob && String(item.status || '').toLowerCase() === 'available')),
          courseInstanceId: course ? String(course.id) : ''
        }
      })
      if (course && !canRetryGeneration) this.setData({ quote: null })
      if (course && state.canPoll && !planInactive && !canRetryGeneration) {
        try {
          const generation = await loadCourseOutline(String(course.id))
          if (version !== this._loadVersion || !this._active) return
          const outlineReady = generation.stage === 'awaiting_outline_confirmation' && generation.outlineDraft && !generation.outlineDraft.confirmedAt
          this.setData({ outlineReady: Boolean(outlineReady), outlineError: '' })
          if (outlineReady) this.setData({ result: { ...this.data.result, title: '课程大纲待确认', copy: '先编辑大纲，再选择 PPT 模式或课程模式。确认后开始生成完整内容。', canPoll: false } })
        } catch (error) {
          if (version !== this._loadVersion || !this._active) return
          this.setData({ outlineReady: false, outlineError: error.message || '课程大纲暂时无法读取' })
        }
      } else this.setData({ outlineReady: false, outlineError: '' })
    } catch (error) {
      if (version !== this._loadVersion || !this._active) return
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '课程进度加载失败', icon: 'none' })
    } finally {
      if (version === this._loadVersion && this._active) {
        this.setData({ loading: false })
        this.schedulePolling()
      }
    }
  },

  editOutline() {
    if (this.data.result && this.data.outlineReady) wx.navigateTo({ url: `/learning/outline/index?courseInstanceId=${encodeURIComponent(this.data.result.courseInstanceId)}` })
  },

  startCourse() {
    const result = this.data.result
    if (!result || !result.canLaunch) return
    wx.redirectTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(result.courseInstanceId)}` })
  },

  startAcceptance() {
    const result = this.data.result
    if (!result || !result.canStartAcceptance || !result.courseInstanceId) return
    wx.navigateTo({ url: `/learning/acceptance-entry/index?courseInstanceId=${encodeURIComponent(result.courseInstanceId)}` })
  },

  async requestQuote() {
    const result = this.data.result
    if (!result || !result.canStartGeneration || this.data.quoting || this.data.quote) return
    if (!this.quoteKey) {
      this.quoteKey = `course-quote-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    this.setData({ quoting: true })
    const lifecycle = this._lifecycle
    try {
      const quote = await createCurrentCourseGenerationQuote(this.planItemId, this.quoteKey)
      if (lifecycle !== this._lifecycle || !this._active) return
      quote.estimatedLowerDisplay = Math.round(quote.estimatedLowerCredits)
      quote.estimatedUpperDisplay = Math.round(quote.estimatedUpperCredits)
      quote.frozenTargetDisplay = Math.round(quote.frozenTargetCredits)
      this.setData({ quote })
    } catch (error) {
      if (lifecycle !== this._lifecycle || !this._active) return
      if (error.code === 'COURSE_ALREADY_REQUESTED') {
        this.clearQuote()
        await this.loadPage()
      }
      wx.showToast({ title: error.message || '课程报价创建失败', icon: 'none' })
    } finally {
      if (lifecycle === this._lifecycle && this._active) this.setData({ quoting: false })
    }
  },

  async startGeneration() {
    const result = this.data.result
    const quote = this.data.quote
    if (!result || !result.canStartGeneration || !quote || this.data.starting) return
    if (quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now()) {
      this.clearQuote()
      wx.showToast({ title: '课程报价已过期，请重新获取。', icon: 'none' })
      return
    }
    if (!this.confirmKey) {
      this.confirmKey = `course-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    this.setData({ starting: true })
    const lifecycle = this._lifecycle
    try {
      await prepareCourseOutlineReview(this.planItemId, this.confirmKey)
      if (lifecycle !== this._lifecycle || !this._active) return
      const created = await confirmCurrentCourseGeneration(quote.quoteId, this.confirmKey)
      if (lifecycle !== this._lifecycle || !this._active) return
      this.courseInstanceId = created.courseInstanceId
      this.clearQuote()
      wx.showToast({ title: created.reused ? '已读取现有生成任务' : '积分已冻结，正在准备大纲', icon: 'none' })
      await this.loadPage()
    } catch (error) {
      if (lifecycle !== this._lifecycle || !this._active) return
      if (error.code === 'COURSE_ALREADY_REQUESTED') {
        this.clearQuote()
        wx.showToast({ title: error.message, icon: 'none' })
        await this.loadPage()
        return
      }
      if (['QUOTE_EXPIRED', 'QUOTE_NOT_AVAILABLE', 'QUOTE_NOT_FOUND', 'QUOTE_INVALID'].includes(error.code)) this.clearQuote()
      wx.showToast({ title: error.message || '课程生成任务创建失败', icon: 'none' })
    } finally {
      if (lifecycle === this._lifecycle && this._active) this.setData({ starting: false })
    }
  },

  clearQuote() {
    this.quoteKey = ''
    this.confirmKey = ''
    this.setData({ quote: null })
  },

  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/learning/index' }) }) }
})
