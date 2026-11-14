const { loadTeacherMeetingRequests, claimTeacherMeetingRequest } = require('../../services/identity')
const { decorateRequest } = require('../../utils/meeting-request-view')

// 待接单的诊断会议（老师端，2026-11-13）：代理在「免费体验」页申请了免费诊断会议的家庭。
// 服务号「待接单」通知点开就是这一页；老师自己接单，一条申请只能一位老师接，接单后这个家庭的孩子绑到自己名下，
// 之后在学生详情里按现有流程预约诊断会议。只认服务中的老师，身份与名单都由课程服务按当前登录判（/api/teacher/meeting-requests）。
Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    // 第一次读到前只画骨架；读到过一次后再回来保留旧数据，后台静默刷新。
    loaded: false,
    failed: false,
    error: '',
    open: [],
    mine: [],
    claiming: '',
    refreshing: false
  },
  onLoad() {
    // 顶栏高度对齐胶囊按钮；只在 onLoad 读一次胶囊位置。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    this.setData({ statusBarHeight, navigationBarHeight: menuButton.height + (menuButton.top - statusBarHeight) * 2 })
  },
  onShow() {
    this.loadPage()
  },
  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.loadPage()
    this.setData({ refreshing: false })
  },
  apply(result) {
    const now = Date.now()
    this.setData({
      loaded: true,
      failed: false,
      open: result.open.map((item) => decorateRequest(item, now)),
      mine: result.mine.map((item) => decorateRequest(item, now))
    })
  },
  async loadPage() {
    const version = this._version = (this._version || 0) + 1
    if (this.data.failed) this.setData({ failed: false })
    try {
      const result = await loadTeacherMeetingRequests()
      if (version !== this._version) return
      this.apply(result)
    } catch (error) {
      if (version !== this._version) return
      // 读到过一次后刷新失败：保留旧名单
      if (this.data.loaded) return
      this.setData({ failed: true, error: (error && error.message) || '请稍后重试。' })
    }
  },
  handleClaim(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.open.find((row) => row.guardianPublicId === id)
    if (!item || this.data.claiming) return
    if (!item.hasChild) {
      wx.showToast({ title: '这个家庭还没有绑定孩子，暂时接不了', icon: 'none' })
      return
    }
    wx.showModal({
      title: '接这个诊断会议？',
      content: `接单后 ${item.childrenText} 会加到你的学生里，请尽快和家长约好时间、预约诊断会议。`,
      confirmText: '接单',
      confirmColor: '#FD7C02',
      success: (result) => { if (result.confirm) this.claim(id) }
    })
  },
  async claim(id) {
    this.setData({ claiming: id })
    try {
      const result = await claimTeacherMeetingRequest(id)
      this._version = (this._version || 0) + 1
      this.apply(result)
      wx.showToast({ title: '已接单', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error && error.message) || '接单没有成功，请稍后重试。', icon: 'none', duration: 2600 })
      // 被别人接走、已撤回：刷新成最新的
      this.loadPage()
    } finally {
      this.setData({ claiming: '' })
    }
  },
  // 我接了的：进这个家庭第一个孩子的学生详情，在那里预约诊断会议。
  openStudent(event) {
    const id = String(event.currentTarget.dataset.id || '')
    const item = this.data.mine.find((row) => row.guardianPublicId === id)
    const child = item && item.children[0]
    if (!child || !child.studentProfileId) return
    wx.navigateTo({ url: `/teacher/student-detail/index?studentProfileId=${encodeURIComponent(child.studentProfileId)}&name=${encodeURIComponent(child.name)}` })
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.redirectTo({ url: '/teacher/workspace/index' })
  }
})
