const {
  addCurrentTopicCandidate,
  loadCurrentTopicCandidates,
  loadKnowledgeMap,
  removeCurrentTopicCandidate
} = require('../../services/identity')

Page({
  data: {
    loading: true,
    failed: false,
    topic: null,
    candidateStatus: 'loading',
    candidateActive: false,
    candidateSubmitting: false
  },

  async onLoad(options) {
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
    this.setData({ loading: true, failed: false })
    try {
      const map = await loadKnowledgeMap(subjectKey)
      const topic = (map.nodes || []).find((item) => String(item.id) === String(topicId))
      if (!topic) throw new Error('当前年级和学科中未找到该知识点。')
      this.topicId = String(topic.id)
      this.setData({ topic })
      await this.loadCandidateState()
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '知识点加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
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
