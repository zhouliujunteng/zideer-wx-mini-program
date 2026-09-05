const { loadCurrentNotifications, markCurrentNotificationRead } = require('../../services/identity')

function formatTime(value) {
  if (!value) return '刚刚'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '刚刚'
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function buildNotification(item) {
  const payload = item.payload || {}
  return {
    ...item,
    title: payload.title || payload.headline || item.template_code || '系统通知',
    summary: payload.summary || payload.content || payload.message || '请查看本次服务更新。',
    timeLabel: formatTime(item.sent_at || item.scheduled_at || item.created_at),
    unread: item.status === 'unread',
    route: payload.target_route || payload.route || ''
  }
}

const typeLabels = {
  assessment: '测评',
  course: '课程',
  payment: '支付',
  family: '家庭',
  promotion: '推广',
  coin: '金币',
  withdrawal: '提现',
  acceptance: '验收',
  teacher_review: '老师核验',
  knowledge: '知识点'
}

function buildFilters(notifications) {
  const types = []
  notifications.forEach((item) => {
    const key = String(item.business_type || '').trim()
    if (key && !types.includes(key)) types.push(key)
  })
  return [
    { id: 'all', label: '全部' },
    { id: 'unread', label: '未读' },
    ...types.map((id) => ({ id, label: typeLabels[id] || id }))
  ]
}

function filterNotifications(notifications, activeFilter) {
  if (activeFilter === 'unread') return notifications.filter((item) => item.unread)
  if (activeFilter !== 'all') return notifications.filter((item) => item.business_type === activeFilter)
  return notifications
}

Page({
  data: { loading: true, failed: false, notifications: [], visibleNotifications: [], filters: [], activeFilter: 'all' },
  onShow() { this.loadPage() },
  async onPullDownRefresh() { await this.loadPage(); wx.stopPullDownRefresh() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const notifications = (await loadCurrentNotifications()).map(buildNotification)
      const filters = buildFilters(notifications)
      const activeFilter = filters.some((item) => item.id === this.data.activeFilter) ? this.data.activeFilter : 'all'
      this.setData({ notifications, filters, activeFilter, visibleNotifications: filterNotifications(notifications, activeFilter) })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '消息加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  setFilter(event) {
    const activeFilter = String(event.currentTarget.dataset.filter || 'all')
    this.setData({ activeFilter, visibleNotifications: filterNotifications(this.data.notifications, activeFilter) })
  },
  async openNotification(event) {
    const id = Number(event.currentTarget.dataset.id)
    const item = this.data.notifications.find((notification) => Number(notification.id) === id)
    if (!item) return
    if (item.unread) {
      try {
        await markCurrentNotificationRead(id)
        const notifications = this.data.notifications.map((notification) => notification.id === item.id ? { ...notification, unread: false, status: 'read' } : notification)
        this.setData({ notifications, visibleNotifications: filterNotifications(notifications, this.data.activeFilter) })
      } catch (error) {
        wx.showToast({ title: error.message || '通知状态更新失败', icon: 'none' })
        return
      }
    }
    const route = String(item.route || '')
    if (!/^\/[A-Za-z0-9_/?=&.-]+$/.test(route) || route.includes('..')) return
    const tabRoutes = ['/pages/home/index', '/pages/learning/index', '/pages/knowledge-map/index', '/pages/me/index']
    if (tabRoutes.includes(route.split('?')[0])) wx.switchTab({ url: route.split('?')[0] })
    else wx.navigateTo({ url: route })
  }
})
