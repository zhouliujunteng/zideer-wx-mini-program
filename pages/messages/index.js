const { loadCurrentNotifications } = require('../../services/identity')
const { buildMessagesModel, normalizeNotification, messageNavigationMetrics, handleBack } = require('../../utils/message-view')
const { attachUiAssets } = require('../../services/ui-assets')

Page({
  data: {
    model: buildMessagesModel([]), notifications: [], loading: true, failed: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 82,
    menuButtonHeight: 32, searchTop: 26, searchRight: 100,
    searchVisible: false, searchFocus: false, searchQuery: ''
  },
  onLoad() { attachUiAssets(this); this.setData(messageNavigationMetrics()) },
  onShow() { this.disposed = false; return this.loadPage() },
  onUnload() { this.disposed = true },
  onResize() { this.setData(messageNavigationMetrics()) },
  async loadPage() {
    const requestId = this.requestId = (this.requestId || 0) + 1
    this.setData({ loading: true, failed: false })
    try {
      const notifications = (await loadCurrentNotifications()).map(normalizeNotification)
      if (this.disposed || requestId !== this.requestId) return
      this.setData({ notifications, model: buildMessagesModel(notifications, { query: this.data.searchQuery }) })
    } catch (error) {
      if (!this.disposed && requestId === this.requestId) this.setData({ failed: true })
    } finally {
      if (!this.disposed && requestId === this.requestId) this.setData({ loading: false })
    }
  },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  handleBack() { handleBack() },
  handleSearchTap() {
    const searchVisible = !this.data.searchVisible
    const searchQuery = searchVisible ? this.data.searchQuery : ''
    this.setData({ searchVisible, searchFocus: searchVisible, searchQuery, model: buildMessagesModel(this.data.notifications, { query: searchQuery }) })
  },
  handleSearchInput(event) {
    const searchQuery = event.detail.value
    this.setData({ searchQuery, model: buildMessagesModel(this.data.notifications, { query: searchQuery }) })
  },
  handleShortcutTap(event) {
    const item = this.data.model.shortcuts.find(shortcut => shortcut.id === event.currentTarget.dataset.id)
    if (item) wx.navigateTo({ url: '/pages/system-messages/index?category=' + encodeURIComponent(item.id) })
  },
  handleTeacherTap() { wx.showToast({ title: '暂无老师沟通记录', icon: 'none' }) },
  handleSystemTap() {
    wx.navigateTo({ url: '/pages/system-messages/index?query=' + encodeURIComponent(this.data.searchQuery) })
  }
})
