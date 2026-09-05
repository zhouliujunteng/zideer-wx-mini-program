const { loadCurrentLearningPlans, createCurrentCourseGenerationQuote, confirmCurrentCourseGeneration } = require('../../services/identity')

const stateMap = {
  planned: { title: '等待生成', copy: '课程已纳入学习计划，正在等待生成任务开始。', tone: 'pending' },
  queued: { title: '等待生成', copy: '课程生成任务已排队。', tone: 'pending' },
  generating: { title: '课程生成中', copy: '正在生成本节课程内容。', tone: 'working' },
  validating: { title: '内容校验中', copy: '正在校验课程内容与学习目标。', tone: 'working' },
  ready: { title: '课程已就绪', copy: '课程内容已准备完成，可以开始学习。', tone: 'ready' },
  completed: { title: '课程已完成', copy: '本节课程已完成，等待后续验收或下一项任务。', tone: 'ready' },
  failed: { title: '生成失败', copy: '课程生成未完成，请稍后刷新学习计划。', tone: 'error' },
  cancelled: { title: '课程已取消', copy: '本次课程已取消，不可继续进入。', tone: 'error' },
  voided_credit_limit: { title: '课程已作废', copy: '本次课程超过结算上限，已作废且不可访问。', tone: 'error' },
  voided_quality_issue: { title: '课程已作废', copy: '课程因质量问题被停用，不可访问。', tone: 'error' }
}

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
  data: { loading: true, failed: false, starting: false, quoting: false, quote: null, result: null },

  onLoad(options) {
    this.planItemId = String(options.planItemId || '')
    this.courseInstanceId = String(options.courseInstanceId || '')
    this.quoteKey = ''
    this.confirmKey = ''
  },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const data = await loadCurrentLearningPlans()
      const items = (data.plans || []).reduce((all, plan) => all.concat(plan.items || []), [])
      const item = items.find((entry) => String(entry.id) === this.planItemId)
      const course = item && (item.courseInstances || []).find((entry) => !this.courseInstanceId || String(entry.id) === this.courseInstanceId)
      if (!item) {
        this.setData({ result: null })
        return
      }
      const courseStatus = String(course && course.status || item.status || 'planned').toLowerCase()
      const generationJob = course && course.generationJob || item.generationJob || null
      const jobStatus = String(generationJob && generationJob.status || '').toLowerCase()
      const status = ['ready', 'in_progress', 'lesson_completed', 'awaiting_acceptance', 'passed', 'closed', 'voided_credit_limit', 'voided_quality_issue', 'failed', 'cancelled'].includes(courseStatus)
        ? courseStatus
        : jobStatus || courseStatus
      const state = stateMap[status] || stateMap.planned
      const settlement = course && course.creditSettlement || null
      this.setData({
        result: {
          taskTitle: item.topicName || '学习任务',
          subject: item.subjectName || '学习计划',
          status,
          ...state,
          credits: creditsRange(settlement, item.estimatedCredits),
          settlementNote: settlement && settlement.actualCredits !== null && settlement.actualCredits !== undefined
            ? `实际结算 ${Math.round(Number(settlement.actualCredits))} 积分${settlement.returnedCredits ? `，退回 ${Math.round(Number(settlement.returnedCredits))} 积分` : ''}`
            : settlement && settlement.frozenCredits !== null && settlement.frozenCredits !== undefined
              ? `已冻结 ${Math.round(Number(settlement.frozenCredits))} 积分，等待最终结算。`
              : '服务端以实际用量结算；页面仅展示取整后的预估。',
          canLaunch: status === 'ready' && Boolean(course && (course.contentVersionRef || course.content_version_ref)),
          canStartGeneration: !course && String(item.status || '').toLowerCase() === 'available',
          courseInstanceId: course ? String(course.id) : ''
        }
      })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '课程进度加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  startCourse() {
    const result = this.data.result
    if (!result || !result.canLaunch) return
    wx.redirectTo({ url: `/learning/course/index?courseInstanceId=${encodeURIComponent(result.courseInstanceId)}` })
  },

  async requestQuote() {
    const result = this.data.result
    if (!result || !result.canStartGeneration || this.data.quoting || this.data.quote) return
    if (!this.quoteKey) {
      this.quoteKey = `course-quote-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    this.setData({ quoting: true })
    try {
      const quote = await createCurrentCourseGenerationQuote(this.planItemId, this.quoteKey)
      quote.estimatedLowerDisplay = Math.round(quote.estimatedLowerCredits)
      quote.estimatedUpperDisplay = Math.round(quote.estimatedUpperCredits)
      quote.frozenTargetDisplay = Math.round(quote.frozenTargetCredits)
      this.setData({ quote })
    } catch (error) {
      wx.showToast({ title: error.message || '课程报价创建失败', icon: 'none' })
    } finally {
      this.setData({ quoting: false })
    }
  },

  async startGeneration() {
    const result = this.data.result
    const quote = this.data.quote
    if (!result || !quote || this.data.starting) return
    if (!this.confirmKey) {
      this.confirmKey = `course-confirm-${Date.now()}-${Math.random().toString(36).slice(2)}`
    }
    this.setData({ starting: true })
    try {
      const created = await confirmCurrentCourseGeneration(quote.quoteId, this.confirmKey)
      this.courseInstanceId = created.courseInstanceId
      this.setData({ quote: null })
      wx.showToast({ title: created.reused ? '已读取现有生成任务' : '积分已冻结，已加入生成队列', icon: 'none' })
      await this.loadPage()
    } catch (error) {
      wx.showToast({ title: error.message || '课程生成任务创建失败', icon: 'none' })
    } finally {
      this.setData({ starting: false })
    }
  },

  goBack() { wx.navigateBack() }
})
