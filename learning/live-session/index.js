const { loadCurrentLiveSchedule, loadCurrentUser } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { buildLiveSessionModel } = require('../../services/live-session-view')

// 真人陪跑会议准备页（M40）。视觉取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram
// 提交 2d60b7b 的 package-learning/pages/learning/live-session（2026-09-21 同步）。
// 与设计稿的差异：
// - 数据全部来自「读取当前学生真人陪跑日程」61446a3a，会议名称、日期时间、时长、状态、
//   老师与出勤都是真实场次字段；设计稿的课程名与「林同学」等 mock 参会者不移植。
// - 未移植设计稿右上角切换六种会议状态的本地预览菜单（同推广页的处理）。
// - 设计稿「进入会议」只弹提示；这里在后端配置了 https 会议链接且处于开放时间时复制链接，
//   没有链接时如实显示「会议入口待配置」，不伪造入会。

const SHEET_DEFAULT_RATIO = 0.47
const TICK_INTERVAL = 1000

Page({
  data: {
    loadState: 'loading',
    stateTitle: '',
    stateCopy: '',
    model: {},
    backTop: 26,
    backSize: 32,
    sheetTopPx: 0,
    sheetVisualOffset: 0,
    sheetTransition: false
  },

  onLoad(options) {
    attachUiAssets(this)
    this.participantId = String((options && options.participantId) || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const windowHeight = windowInfo.windowHeight || 667
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: statusBarHeight + 6, height: 32, left: (windowInfo.windowWidth || 375) - 92 }
    const backSize = menuButton.height || 32
    const sheetDefaultTop = Math.round(windowHeight * SHEET_DEFAULT_RATIO)
    const sheetExpandedTop = Math.max(statusBarHeight + backSize + 28, 88)
    this._sheetDefaultTop = sheetDefaultTop
    this._sheetTravel = Math.max(0, sheetDefaultTop - sheetExpandedTop)
    this.setData({
      backTop: menuButton.top || statusBarHeight + 6,
      backSize,
      sheetTopPx: sheetDefaultTop
    })
  },

  onShow() {
    return this.loadPage()
  },

  onHide() {
    this.stopTicking()
  },

  onUnload() {
    this.stopTicking()
    if (this._sheetTransitionTimer) clearTimeout(this._sheetTransitionTimer)
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading' })
    try {
      // 头像与昵称只为参会者卡片服务，读取失败不影响会议信息展示。
      const [schedule, currentUser] = await Promise.all([
        loadCurrentLiveSchedule(),
        loadCurrentUser().catch(() => null)
      ])
      if (requestId !== this._loadRequestId) return
      const participant = schedule.sessions.find((entry) => String(entry.id) === this.participantId) || null
      if (!participant || !participant.session || !participant.session.id) {
        this.stopTicking()
        this.setData({
          loadState: 'missing',
          stateTitle: '该场次暂不可查看',
          stateCopy: '场次可能已取消、改派，或当前身份无权查看。'
        })
        return
      }
      this._participant = participant
      this._viewer = this.buildViewer(schedule.profile, currentUser)
      const model = buildLiveSessionModel(participant, { viewer: this._viewer })
      this.setData({ loadState: 'ready', model })
      if (model.ticking) this.startTicking()
      else this.stopTicking()
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      // 已显示过的场次回到本页刷新失败时保留原内容，倒计时照常走。
      if (this.data.loadState === 'ready') return
      this.stopTicking()
      this.setData({
        loadState: 'failed',
        stateTitle: '场次详情暂时无法加载',
        stateCopy: error && error.message ? error.message : '请确认网络和登录状态后重新读取。'
      })
    }
  },

  buildViewer(profile, currentUser) {
    const account = currentUser && currentUser.profile ? currentUser.profile : null
    const name = (account && (account.nickname || account.real_name))
      || (profile && (profile.nickname || profile.realName))
      || ''
    return {
      name: String(name || '').trim(),
      avatarUrl: account && (account.avatar_url || (account.avatar && account.avatar.url)) || ''
    }
  },

  startTicking() {
    if (this._ticker) return
    this._ticker = setInterval(() => this.tick(), TICK_INTERVAL)
  },

  stopTicking() {
    if (!this._ticker) return
    clearInterval(this._ticker)
    this._ticker = null
  },

  // 待开始的倒计时、即将开始的 mm:ss 和进行中的计时都随时间变化，整分钟之外只改动文案字段。
  tick() {
    if (!this._participant) return
    const next = buildLiveSessionModel(this._participant, { viewer: this._viewer })
    const current = this.data.model || {}
    if (next.state !== current.state) {
      this.setData({ model: next })
      if (!next.ticking) this.stopTicking()
      return
    }
    if (next.statusTimer === current.statusTimer && next.statusDescription === current.statusDescription) return
    this.setData({ 'model.statusTimer': next.statusTimer, 'model.statusDescription': next.statusDescription })
  },

  handleJoin() {
    const model = this.data.model || {}
    const meeting = model.meeting || {}
    if (model.state === 'exception') {
      this.openDailyTask()
      return
    }
    if (model.state === 'unauthorized') {
      this.handleBack()
      return
    }
    if (!meeting.canJoin) {
      wx.showToast({ title: meeting.notice || '会议尚未开始', icon: 'none' })
      return
    }
    const meetingRef = this._participant && this._participant.session && this._participant.session.meetingRef
    // 小程序不能直接打开外部会议地址，复制链接是当前唯一不伪造入会的真实动作。
    wx.setClipboardData({
      data: String(meetingRef || ''),
      success: () => wx.showToast({ title: '会议链接已复制，请在会议应用中打开', icon: 'none' }),
      fail: () => wx.showToast({ title: '会议链接复制失败，请稍后重试', icon: 'none' })
    })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/learning/index' })
  },

  openDailyTask() {
    wx.navigateTo({ url: '/learning/daily-task/index' })
  },

  handleSheetTouchStart(event) {
    const touch = event.touches && event.touches[0]
    if (!touch) return
    const point = this.getSheetTouchPoint(touch)
    this._sheetTouch = { x: point.x, y: point.y, offset: Number(this.data.sheetVisualOffset) || 0, kind: '' }
  },

  handleSheetTouchMove(event) {
    const touch = event.touches && event.touches[0]
    if (!touch || !this._sheetTouch) return
    const point = this.getSheetTouchPoint(touch)
    const gesture = this._sheetTouch
    const dx = point.x - gesture.x
    const dy = point.y - gesture.y
    if (!gesture.kind) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return
      gesture.kind = Math.abs(dy) >= Math.abs(dx) ? 'vertical' : 'horizontal'
    }
    if (gesture.kind !== 'vertical') return
    const offset = Math.max(0, Math.min(this._sheetTravel, gesture.offset - dy))
    this.setData({
      sheetTransition: false,
      sheetVisualOffset: offset,
      sheetTopPx: this._sheetDefaultTop - offset
    })
  },

  handleSheetTouchEnd() {
    const gesture = this._sheetTouch
    this._sheetTouch = null
    if (!gesture || gesture.kind !== 'vertical') return
    const delta = Number(this.data.sheetVisualOffset) - gesture.offset
    const expanded = delta > 6
      ? true
      : delta < -6
        ? false
        : Number(this.data.sheetVisualOffset) >= this._sheetTravel / 2
    const targetOffset = expanded ? this._sheetTravel : 0
    this.setData({
      sheetTransition: true,
      sheetVisualOffset: targetOffset,
      sheetTopPx: this._sheetDefaultTop - targetOffset
    })
    if (this._sheetTransitionTimer) clearTimeout(this._sheetTransitionTimer)
    this._sheetTransitionTimer = setTimeout(() => {
      this._sheetTransitionTimer = null
      this.setData({ sheetTransition: false })
    }, 420)
  },

  getSheetTouchPoint(touch) {
    return {
      x: Number(touch && (touch.x !== undefined ? touch.x : touch.clientX !== undefined ? touch.clientX : touch.pageX)) || 0,
      y: Number(touch && (touch.y !== undefined ? touch.y : touch.clientY !== undefined ? touch.clientY : touch.pageY)) || 0
    }
  }
})
