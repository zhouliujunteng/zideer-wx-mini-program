const { loadKnowledgeMap } = require('../../services/identity')
const { syncTab } = require('../../utils/navigation')

Page({
  data: {
    navigation: {},
    loading: true,
    loadFailed: false,
    subjects: [],
    activeSubject: '',
    activeSubjectKey: '',
    grade: '',
    stats: null,
    nodes: [],
    edges: [],
    scaleValue: 1,
    selectedNodeId: '',
    selectedNode: null,
    sheetOpen: false,
    searchOpen: false,
    searchQuery: '',
    searchResults: []
  },

  onLoad() {
    this.setData({ navigation: getApp().globalData.navigation || {} })
  },

  async onShow() {
    syncTab(this, 2)
    if (!this.data.nodes.length) await this.loadPage()
  },

  async loadPage() {
    this.setData({ loading: true, loadFailed: false })
    try {
      const map = await loadKnowledgeMap(this.data.activeSubjectKey)
      this.setData({
        subjects: map.subjects,
        activeSubject: map.activeSubject,
        activeSubjectKey: map.activeSubjectKey,
        grade: map.grade,
        stats: map.stats,
        nodes: map.nodes,
        edges: map.edges
      })
    } catch (error) {
      this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '知识图谱加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  chooseSubject(event) {
    const subjectKey = event.currentTarget.dataset.subjectKey
    if (subjectKey === this.data.activeSubjectKey) return
    this.setData({ activeSubjectKey: subjectKey, selectedNodeId: '', selectedNode: null, sheetOpen: false })
    this.loadPage()
  },

  selectNode(event) {
    const id = event.currentTarget.dataset.id
    const selectedNode = this.data.nodes.find((item) => item.id === id)
    if (!selectedNode) return
    this.setData({ selectedNodeId: selectedNode.id, selectedNode, sheetOpen: true })
  },

  closeSheet() {
    this.setData({ sheetOpen: false })
  },

  zoomIn() {
    this.setData({ scaleValue: Math.min(1.8, Number((this.data.scaleValue + 0.15).toFixed(2))) })
  },

  zoomOut() {
    this.setData({ scaleValue: Math.max(0.7, Number((this.data.scaleValue - 0.15).toFixed(2))) })
  },

  searchTopics() {
    this.setData({ searchOpen: true, sheetOpen: false, searchQuery: '', searchResults: [] })
  },

  onSearchInput(event) {
    const searchQuery = String(event.detail.value || '').trim()
    const keyword = searchQuery.toLocaleLowerCase()
    const searchResults = keyword
      ? this.data.nodes.filter((item) => {
        const text = `${item.label || ''} ${item.shortLabel || ''} ${item.prerequisites || ''}`.toLocaleLowerCase()
        return text.includes(keyword)
      }).slice(0, 20).map((item) => ({
        ...item,
        searchMeta: item.prerequisites === '无' ? '无前置知识' : `前置：${item.prerequisites || '待补充'}`
      }))
      : []
    this.setData({ searchQuery, searchResults })
  },

  clearSearch() {
    this.setData({ searchQuery: '', searchResults: [] })
  },

  closeSearch() {
    this.setData({ searchOpen: false, searchQuery: '', searchResults: [] })
  },

  selectSearchResult(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const selectedNode = this.data.nodes.find((item) => String(item.id) === id)
    if (!selectedNode) return
    this.setData({
      selectedNodeId: selectedNode.id,
      selectedNode,
      sheetOpen: true,
      searchOpen: false,
      searchQuery: '',
      searchResults: []
    })
  },

  addToPlan() {
    wx.showToast({ title: '学习计划功能正在接入，暂不能加入候选。', icon: 'none' })
  },

  openTopicDetail() {
    const node = this.data.selectedNode
    if (!node || !node.id) return
    wx.navigateTo({
      url: `/diagnosis/topic/index?topicId=${encodeURIComponent(node.id)}&subjectKey=${encodeURIComponent(this.data.activeSubjectKey)}`
    })
  }
})
