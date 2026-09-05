const { loadKnowledgeMap } = require('../../services/identity')

Page({
  data: { loading: true, failed: false, topic: null },

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
      this.setData({ topic })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '知识点加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  }
})
