const { loadCurrentNotifications, markCurrentNotificationRead } = require('../../services/identity')
const { buildMessagesModel, normalizeNotification, messageNavigationMetrics, handleBack, navigateNotification } = require('../../utils/message-view')

Page({
  // 第一次读到通知前列表位只显示骨架；读到过一次后再回来保留旧消息，后台静默刷新。
  data: { model: buildMessagesModel([]), notifications: [], loading: true, loaded: false, failed: false, category: 'all', query: '', openingId: null, statusBarHeight: 20, navigationBarHeight: 44, contentTop: 82 },
  onLoad(options = {}) {
    const category = options.category || 'all'
    const query = options.query || ''
    // 标题按分类立即显示，不先闪「系统消息」
    this.setData({ ...messageNavigationMetrics(), category, query, model: buildMessagesModel([], { category, query }) })
  },
  onShow() { this.disposed = false; return this.loadPage() },
  onUnload() { this.disposed = true },
  onResize() { this.setData(messageNavigationMetrics()) },
  async loadPage() {
    const requestId = this.requestId = (this.requestId || 0) + 1
    this.setData({ loading: true, failed: false })
    try {
      const notifications = (await loadCurrentNotifications()).map(normalizeNotification)
      if (this.disposed || requestId !== this.requestId) return
      this.setData({ notifications, loaded: true, model: buildMessagesModel(notifications, this.data) })
    } catch (error) {
      if (this.disposed || requestId !== this.requestId) return
      // 已有消息时刷新失败只提示，不把旧消息换成错误页。
      if (this.data.loaded) wx.showToast({ title: '消息刷新失败', icon: 'none' })
      else this.setData({ failed: true })
    } finally {
      if (!this.disposed && requestId === this.requestId) this.setData({ loading: false })
    }
  },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  handleBack() { handleBack() },
  async handleSystemTap(event) {
    if (this.data.openingId !== null || !this.data.loaded) return
    const id = Number(event.currentTarget.dataset.id)
    const item = this.data.notifications.find(notification => Number(notification.id) === id)
    if (!item) return
    this.setData({ openingId: id })
    try {
      if (item.unread) {
        await markCurrentNotificationRead(id)
        if (this.disposed) return
        const notifications = this.data.notifications.map(notification => notification.id === item.id
          ? { ...notification, status: 'read', unread: false, unreadDot: false, unreadCount: 0, badgeLabel: '' }
          : notification)
        this.setData({ notifications, model: buildMessagesModel(notifications, this.data) })
      }
      navigateNotification(item)
    } catch (error) {
      if (!this.disposed) wx.showToast({ title: error.message || '通知状态更新失败', icon: 'none' })
    } finally {
      if (!this.disposed) this.setData({ openingId: null })
    }
  }
})
