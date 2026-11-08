const {
  getStoredToken,
  loadGuardianParentReports,
  downloadGuardianParentReport,
  accessOfError
} = require('../../services/identity')
const { openLogin } = require('../../utils/access-gate')
const { readAccountType } = require('../../utils/account-role')
const { groupGuardianReports } = require('../../utils/guardian-report-view')

// 家长「学习报告」（2026-10-07 用户规则）：老师在「学生详情 › 家长学习报告」给孩子出的报告，家长在这里同步看到；
// 老师删掉的不再出现。入口：「我的 › 常用入口 › 学习报告」、服务号菜单「我的服务 › 学习报告」推送的报告卡片
// （带 reportId，进来后直接打开那一份）。游客能打开本页（服务号卡片点进来可能还没登录），只显示登录提示。
// 能看哪些孩子由课程服务按登录账号现查家长绑定；读列表时课程服务顺带登记本账号的微信 UnionID，服务号据此认人。

function errorText(error, fallback) {
  return error && error.message ? error.message : fallback
}

function isLoginError(error) {
  return accessOfError(error) === 'guest' || (error && error.code === 'LOGIN_REQUIRED')
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    // loading（第一次读之前，画骨架）/ guest / ready / failed
    loadState: 'loading',
    loadError: '',
    refreshing: false,
    isStudent: false,
    groups: [],
    waiting: [],
    waitingText: '',
    total: 0,
    hasStudents: false,
    focusId: '',
    openingId: ''
  },

  onLoad(options = {}) {
    this._files = {}
    const reportId = String(options.reportId || '')
    this._pendingOpen = /^[a-f0-9]{32}$/.test(reportId) ? reportId : ''
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + Math.max(4, menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18,
      focusId: this._pendingOpen
    })
  },

  onShow() {
    this.setData({ isStudent: readAccountType() === 'student' })
    return this.load()
  },

  onUnload() {
    this._unloaded = true
    const fs = wx.getFileSystemManager ? wx.getFileSystemManager() : null
    Object.values(this._files || {}).forEach((filePath) => {
      if (fs && filePath) fs.unlink({ filePath, fail() {} })
    })
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.load()
    this.setData({ refreshing: false })
  },

  async load() {
    if (!getStoredToken()) {
      this.setData({ loadState: 'guest' })
      return
    }
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const view = await loadGuardianParentReports()
      if (requestId !== this._requestId || this._unloaded) return
      this.apply(view)
    } catch (error) {
      if (requestId !== this._requestId || this._unloaded) return
      if (isLoginError(error)) {
        this.setData({ loadState: 'guest' })
        return
      }
      // 读到过一次后刷新失败：保留页面上的报告，只提示一下
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: errorText(error, '刷新失败，请稍后重试'), icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: errorText(error, '请稍后重试。') })
    }
  },

  apply(view) {
    const grouped = groupGuardianReports(view)
    this._ids = new Set(grouped.groups.reduce((all, group) => all.concat(group.reports.map((r) => r.id)), []))
    this.setData({
      loadState: 'ready',
      loadError: '',
      groups: grouped.groups,
      waiting: grouped.waiting,
      waitingText: grouped.waiting.join('、'),
      total: grouped.total,
      hasStudents: grouped.hasStudents
    })
    // 从服务号报告卡片进来：直接打开那一份；老师已经删掉的提示一下
    const pending = this._pendingOpen
    if (pending) {
      this._pendingOpen = ''
      if (this._ids.has(pending)) this.openReport(pending)
      else wx.showToast({ title: '这份报告已被老师撤回，下面是现有的报告', icon: 'none' })
    }
  },

  handleLogin() {
    openLogin()
  },

  handleBindStudent() {
    wx.navigateTo({ url: '/account/bind-student/index' })
  },

  handleOpen(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : ''
    if (!id || !this._ids || !this._ids.has(id)) return
    this.openReport(id)
  },

  async openReport(id) {
    if (this.data.openingId) return
    this.setData({ openingId: id, focusId: id })
    try {
      const filePath = this._files[id] || await downloadGuardianParentReport(id)
      if (this._unloaded) return
      this._files[id] = filePath
      wx.openDocument({
        filePath,
        fileType: 'pdf',
        showMenu: true,
        fail: () => wx.showToast({ title: '报告打开失败，请稍后重试', icon: 'none' })
      })
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: errorText(error, '报告暂时下载不了，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ openingId: '' })
    }
  }
})
