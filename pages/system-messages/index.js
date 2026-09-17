const { loadCurrentNotifications, markCurrentNotificationRead } = require('../../services/identity')
const { buildMessagesModel, normalizeNotification, messageNavigationMetrics, handleBack, navigateNotification } = require('../../utils/message-view')

Page({
  data: { model: buildMessagesModel([]), notifications: [], loading: true, failed: false, category: 'all', query: '', openingId: null, statusBarHeight: 20, navigationBarHeight: 44, contentTop: 82 },
  onLoad(options = {}) {
    this.setData({ ...messageNavigationMetrics(), category: options.category || 'all', query: options.query || '' })
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
      this.setData({ notifications, model: buildMessagesModel(notifications, this.data) })
    } catch (error) {
      if (!this.disposed && requestId === this.requestId) this.setData({ failed: true })
    } finally {
      if (!this.disposed && requestId === this.requestId) this.setData({ loading: false })
    }
  },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  handleBack() { handleBack() },
  async handleSystemTap(event) {
    if (this.data.openingId !== null || this.data.loading || this.data.failed) return
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
