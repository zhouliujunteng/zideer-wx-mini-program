const {
  addCurrentTopicCandidate,
  loadCurrentTopicCandidates,
  loadKnowledgeTopic,
  removeCurrentTopicCandidate
} = require('../../services/identity')
const assessment = require('../../services/assessment')
const { rpxToPx } = require('../../utils/screen')

// 掌握状态配色与测评页一致：掌握 solid / 待巩固 steady / 未掌握 weak / 待测 pending
const STATE_TONES = { mastered: 'solid', reinforce: 'steady', not_mastered: 'weak' }
const EVIDENCE_TYPES = { assessment: { label: '测评', tone: 'steady' }, ai_acceptance: { label: 'AI 验收', tone: 'pending' }, teacher_verified: { label: '老师核验', tone: 'solid' } }

function dateLabel(value) { return value ? String(value).slice(0, 10) : '' }

// 顶部的学段学科、教材出处，以及掌握证据行（证据原样来自 k12_evidence：类型、摘要、发生时间）
function topicView(topic) {
  const evidence = (topic.evidenceRecords || []).map((record, index) => {
    const type = EVIDENCE_TYPES[record.evidence_type] || null
    return { id: record.id || index, title: record.summary || (type ? `${type.label}证据` : '学习证据'), dateLabel: dateLabel(record.occurred_at), typeLabel: type ? type.label : '', tone: type ? type.tone : 'pending' }
  })
  return {
    eyebrow: [topic.gradeLabel, topic.subjectName].filter(Boolean).join(' · '),
    source: [topic.volume, topic.unit].filter(Boolean).join(' · '),
    evidence
  }
}

Page({
  data: {
    // 知识点、测评状态、候选状态都读完才算 loaded；之前各分节保留标题、内容画骨架。
    loaded: false,
    failed: false,
    topic: null,
    view: null,
    candidateStatus: 'loading',
    candidateActive: false,
    candidateSubmitting: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80
  },

  async onLoad(options) {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
    const topicId = String(options.topicId || '')
    const subjectKey = decodeURIComponent(options.subjectKey || '')
    if (!topicId) {
      wx.showToast({ title: '缺少知识点标识', icon: 'none' })
      wx.navigateBack()
      return
    }
    await this.loadTopic(topicId, subjectKey)
  },

  async loadTopic(topicId, subjectKey) {
    this._topicArgs = [topicId, subjectKey]
    this.setData({ failed: false })
    try {
      const topic = await loadKnowledgeTopic(topicId)
      this.topicId = String(topic.id)
      this.setData({ topic, view: topicView(topic) })
      try {
        const detail = await assessment.call('topic', { topicId:Number(topic.id) })
        const states = (detail.states || []).map(s => ({ ...s, stateLabel: assessment.masteryLabel(s), rateLabel: s.n ? `${s.c}/${s.n}` : '待测', dateLabel: dateLabel(s.occurredAt), tone: STATE_TONES[s.state] || 'pending' }))
        this.setData({ assessmentStatus: states.length ? states[0].stateLabel : '待测', assessmentTone: states.length ? states[0].tone : 'pending', states, assessmentError: false })
      } catch (_) { this.setData({ assessmentError: true }) }
      await this.loadCandidateState()
      this.setData({ loaded: true })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '知识点加载失败', icon: 'none' })
    }
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/home/index' })
  },

  retryLoad() {
    if (this._topicArgs) return this.loadTopic(...this._topicArgs)
  },

  openRelatedTopic(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.redirectTo({ url: `/diagnosis/topic/index?topicId=${encodeURIComponent(id)}` })
  },

  async loadCandidateState() {
    try {
      const result = await loadCurrentTopicCandidates()
      const candidateActive = result.status === 'ready' && result.candidates.some(
        (candidate) => String(candidate.topicId) === this.topicId && candidate.status === 'active'
      )
      this.setData({ candidateStatus: result.status, candidateActive })
    } catch (error) {
      this.setData({ candidateStatus: 'unavailable', candidateActive: false })
    }
  },

  async toggleCandidate() {
    const topic = this.data.topic
    if (!topic || !topic.id || this.data.candidateSubmitting) return
    if (this.data.candidateStatus === 'profile_incomplete') {
      wx.showToast({ title: '请先完善学习档案后加入候选', icon: 'none' })
      return
    }
    this.setData({ candidateSubmitting: true })
    try {
      if (this.data.candidateActive) {
        await removeCurrentTopicCandidate(topic.id)
        this.setData({ candidateStatus: 'ready', candidateActive: false })
        wx.showToast({ title: '已移出候选', icon: 'success' })
      } else {
        const result = await addCurrentTopicCandidate(topic.id)
        this.setData({ candidateStatus: 'ready', candidateActive: true })
        wx.showToast({
          title: result.status === 'reactivated' ? '已恢复到候选' : result.status === 'already_active' ? '已在候选中' : '已加入候选',
          icon: 'success'
        })
      }
    } catch (error) {
      wx.showToast({ title: error.message || '候选操作失败', icon: 'none' })
    } finally {
      this.setData({ candidateSubmitting: false })
    }
  }
})
