const shortcuts = [
  { id: 'learning', label: '学习动态', icon: '../../assets/messages/learning.svg', tone: 'cyan', types: ['course', 'knowledge', 'acceptance'] },
  { id: 'assessment', label: '评测反馈', icon: '../../assets/messages/assessment.svg', tone: 'blue', types: ['assessment'] },
  { id: 'teacher-feedback', label: '老师反馈', icon: '../../assets/messages/teacher.svg', tone: 'pink', types: ['teacher_review'] }
]

function badge(count) {
  return { unreadCount: count, badgeLabel: count >= 99 ? '99+' : count > 0 ? String(count) : '', badgeClass: count >= 10 ? 'message-badge-pill' : 'message-badge-circle' }
}

function formatTime(value, now = new Date()) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) return '刚刚'
  if (date.toDateString() === now.toDateString()) return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return `${date.getFullYear() === now.getFullYear() ? '' : date.getFullYear() + '/'}${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function normalizeNotification(item) {
  const payload = item.payload && typeof item.payload === 'object' ? item.payload : {}
  const unread = item.status === 'unread'
  return {
    ...item, ...badge(unread ? 1 : 0), unread, unreadDot: unread, badgeLabel: '',
    title: payload.title || payload.headline || item.template_code || '系统通知',
    preview: payload.summary || payload.content || payload.message || '请查看本次服务更新。',
    time: formatTime(item.sent_at || item.scheduled_at || item.created_at),
    route: payload.target_route || payload.route || ''
  }
}

function buildMessagesModel(notifications, { query = '', category = 'all' } = {}) {
  const needle = String(query).trim().toLowerCase()
  const shortcut = shortcuts.find(item => item.id === category)
  const systemMessages = notifications.filter(item => {
    if (shortcut && !shortcut.types.includes(item.business_type)) return false
    if (category === 'unread' && !item.unread) return false
    return !needle || [item.title, item.preview].join(' ').toLowerCase().includes(needle)
  })
  return {
    shortcuts: shortcuts.map(item => ({ ...item, ...badge(notifications.filter(notification => notification.unread && item.types.includes(notification.business_type)).length) })),
    // The current service exposes notifications, not teacher chat accounts.
    teacherConversations: [], showTeacherSection: false, teacherCountLabel: '0条信息',
    systemMessages, showSystemSection: systemMessages.length > 0,
    systemCountLabel: `${systemMessages.length}条信息`,
    unreadCount: notifications.filter(item => item.unread).length,
    searchPlaceholder: '搜索消息标题或内容',
    emptyText: needle ? '没有找到相关消息' : '这里还没有相关消息',
    title: shortcut ? shortcut.label : '系统消息'
  }
}

function messageNavigationMetrics() {
  let windowInfo = {}
  try { windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch (error) {}
  const windowWidth = windowInfo.windowWidth || 375
  const statusBarHeight = windowInfo.statusBarHeight == null ? 20 : windowInfo.statusBarHeight
  let menu = { left: windowWidth - 92, top: statusBarHeight + 6, height: 32 }
  try { const actual = wx.getMenuButtonBoundingClientRect(); if (actual.height > 0) menu = actual } catch (error) {}
  const navigationBarHeight = menu.height + Math.max(0, menu.top - statusBarHeight) * 2
  return { statusBarHeight, navigationBarHeight, menuButtonHeight: menu.height, searchTop: menu.top, searchRight: windowWidth - menu.left + 8, contentTop: statusBarHeight + navigationBarHeight + 18 }
}

function handleBack() {
  if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
  else wx.switchTab({ url: '/pages/home/index' })
}

function navigateNotification(item) {
  const route = String(item.route || '')
  if (!/^\/[A-Za-z0-9_/?=&.-]+$/.test(route) || route.includes('..')) {
    wx.showModal({ title: item.title, content: item.preview, showCancel: false })
    return
  }
  const tabs = ['/pages/home/index', '/pages/learning/index', '/pages/knowledge-map/index', '/pages/me/index']
  if (tabs.includes(route.split('?')[0])) wx.switchTab({ url: route.split('?')[0] })
  else wx.navigateTo({ url: route, fail: () => wx.showToast({ title: '消息对应内容暂时无法打开', icon: 'none' }) })
}

module.exports = { buildMessagesModel, normalizeNotification, messageNavigationMetrics, handleBack, navigateNotification }
