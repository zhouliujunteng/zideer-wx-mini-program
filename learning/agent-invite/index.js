const { loadTeacherAgentInvite, loadCurrentUser } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { buildAgentInviteModel, inviteCoverOptions } = require('../../services/agent-invite-view')
const { prepareShareCover, shareWithCover } = require('../../services/share-cover')
const config = require('../../config/index')

// 老师预约后生成的分享页：学生本人从微信分享卡片点进来。
// 视觉复用 M40 会议准备页（learning/live-session），数据来自「查询教师智能体邀请」e0238566。
// 后端只对被邀请的学生本人返回 ready，老师与家长会被拒，这两种情况都走页面态而不是报错弹窗。

const SHEET_DEFAULT_RATIO = 0.47
// 加日历：占一小时的时段、提前 10 分钟提醒
const CALENDAR_BLOCK_SECONDS = 60 * 60
const CALENDAR_ALARM_SECONDS = 10 * 60

function reminderTemplateId() {
  return (config.SUBSCRIBE_TEMPLATES && config.SUBSCRIBE_TEMPLATES.LIVE_MEETING_REMINDER) || ''
}

// 模板 ID 和到点发送的动作流两样都在，订阅才兑现得了；缺一样就不给按钮。
function reminderReady() {
  const flow = config.ACTION_FLOWS && config.ACTION_FLOWS.LIVE_MEETING_REMINDER
  return Boolean(reminderTemplateId() && flow && flow.id)
}
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
    sheetTransition: false,
    // 「订阅通知」要模板 ID 和到点发送的后端都就位才给（见 config/index.js 的说明）
    canSubscribe: false,
    subscribed: false,
    calendarAdded: false
  },

  onLoad(options) {
    attachUiAssets(this)
    this.token = decodeURIComponent(String((options && options.token) || ''))
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
    this.setData({ canSubscribe: reminderReady(), ...this.readReminderMarks() })
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
      const [payload, currentUser] = await Promise.all([
        loadTeacherAgentInvite(this.token),
        loadCurrentUser().catch(() => null)
      ])
      if (requestId !== this._loadRequestId) return
      this._payload = payload
      this._viewer = this.buildViewer(currentUser)
      const model = buildAgentInviteModel(payload, { viewer: this._viewer })
      if (model.blocked) {
        this.stopTicking()
        this.setData({ loadState: 'blocked', stateTitle: model.stateTitle, stateCopy: model.stateCopy })
        return
      }
      this.setData({ loadState: 'ready', model })
      if (model.ticking) this.startTicking()
      else this.stopTicking()
      prepareShareCover(this, this.inviteCover())
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      // 已显示过的预约回到本页刷新失败时保留原内容，倒计时照常走。
      if (this.data.loadState === 'ready') return
      this.stopTicking()
      this.setData({
        loadState: 'failed',
        stateTitle: '预约暂时无法读取',
        stateCopy: error && error.message ? error.message : '请确认网络和登录状态后重试。'
      })
    }
  },

  buildViewer(currentUser) {
    const account = currentUser && currentUser.profile ? currentUser.profile : null
    return {
      name: String((account && (account.nickname || account.real_name)) || '').trim(),
      avatarUrl: (account && (account.avatar_url || (account.avatar && account.avatar.url))) || ''
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

  tick() {
    if (!this._payload) return
    const next = buildAgentInviteModel(this._payload, { viewer: this._viewer })
    const current = this.data.model || {}
    if (next.state !== current.state) {
      this.setData({ model: next })
      if (!next.ticking) this.stopTicking()
      return
    }
    if (next.statusDescription === current.statusDescription) return
    this.setData({ 'model.statusDescription': next.statusDescription })
  },

  // 订阅开课提醒。wx.requestSubscribeMessage 必须在点击的同一个调用栈里直接调，
  // 中间隔一个 await 微信就会拒绝（要求由用户点击触发），所以这里不做任何异步前置。
  handleSubscribe() {
    const templateId = reminderTemplateId()
    if (!templateId || !reminderReady()) return
    if (this.data.subscribed) {
      wx.showToast({ title: '已经订阅过了，开始前会提醒你', icon: 'none' })
      return
    }
    wx.requestSubscribeMessage({
      tmplIds: [templateId],
      success: (result) => {
        const choice = result && result[templateId]
        if (choice === 'accept') {
          this.setData({ subscribed: true })
          this.saveReminderMark('subscribed')
          wx.showToast({ title: '已订阅，开始前会提醒你', icon: 'none' })
          this.recordReminder(templateId)
          return
        }
        if (choice === 'ban') {
          wx.showToast({ title: '通知被关掉了，可在微信「设置 › 通知」里打开', icon: 'none', duration: 3000 })
          return
        }
        wx.showToast({ title: '没有订阅，想要提醒可以再点一次', icon: 'none' })
      },
      fail: (error) => {
        // 20004：用户在设置里关掉了本小程序的订阅消息主开关
        const blocked = error && Number(error.errCode) === 20004
        wx.showToast({ title: blocked ? '订阅消息被关掉了，可在小程序「设置」里打开' : '订阅没有成功，请稍后再试', icon: 'none', duration: 3000 })
      }
    })
  },

  // 本机记住这场会议已经订阅 / 加过日历，回到这页还是对勾，不会让学生再加一条重复的日历。
  // 只是这台设备上的便利：读写失败就当没做过，不影响任何功能。
  reminderMarkKey() {
    return `zhilu-meeting-reminders-${this.token || ''}`
  },

  readReminderMarks() {
    let stored = null
    try { stored = wx.getStorageSync(this.reminderMarkKey()) } catch (error) { stored = null }
    return {
      subscribed: Boolean(stored && stored.subscribed),
      calendarAdded: Boolean(stored && stored.calendarAdded)
    }
  },

  saveReminderMark(name) {
    try {
      const marks = { ...this.readReminderMarks(), [name]: true }
      wx.setStorageSync(this.reminderMarkKey(), marks)
    } catch (error) {
      // 记不住只是下次进来又显示成没做过
    }
  },

  // 学生点了「允许」只是给了一次发送机会，真正到点发出去靠后端记下这次订阅。
  recordReminder(templateId) {
    const flow = config.ACTION_FLOWS.LIVE_MEETING_REMINDER
    if (!flow || !flow.id) return
    const { invokeActionFlow } = require('../../services/identity')
    invokeActionFlow(flow, { payload: { operation: 'reminder.subscribe', token: this.token, templateId } })
      .catch(() => wx.showToast({ title: '提醒没有记上，请再点一次订阅', icon: 'none' }))
  },

  // 写进手机系统日历，开始前 10 分钟由系统提醒——不依赖订阅消息，也不依赖后端。
  handleAddCalendar() {
    if (this.data.calendarAdded) {
      wx.showToast({ title: '已经在日历里了', icon: 'none' })
      return
    }
    const model = this.data.model || {}
    if (!model.startAt) {
      wx.showToast({ title: '会议时间还没定，暂时加不了日历', icon: 'none' })
      return
    }
    if (typeof wx.addPhoneCalendar !== 'function') {
      wx.showToast({ title: '当前微信版本不支持加日历，请升级后再试', icon: 'none' })
      return
    }
    const start = Math.floor(model.startAt / 1000)
    const teacher = (model.teacher && model.teacher.name) || '老师'
    wx.addPhoneCalendar({
      title: model.title || '专属诊断会议',
      startTime: start,
      // 邀请本身没有结束时间；日历里 0 时长的事件在多数手机上显示不出来，按一小时占位。
      endTime: start + CALENDAR_BLOCK_SECONDS,
      description: `${teacher}的${model.title || '专属诊断会议'}。到点后打开「知鹿学习」小程序进入诊断室。`,
      alarm: true,
      alarmOffset: CALENDAR_ALARM_SECONDS,
      success: () => {
        this.setData({ calendarAdded: true })
        this.saveReminderMark('calendarAdded')
        wx.showToast({ title: '已加到日历，开始前 10 分钟提醒', icon: 'none' })
      },
      fail: (error) => {
        const message = String((error && error.errMsg) || '')
        if (/cancel/i.test(message)) return
        const denied = /auth|deny|authorize|permission/i.test(message)
        wx.showToast({ title: denied ? '没有日历权限，可在手机「设置」里给微信打开' : '没有加上，请稍后再试', icon: 'none', duration: 3000 })
      }
    })
  },

  handleEnter() {
    const model = this.data.model || {}
    const action = model.action || {}
    if (model.state === 'canceled') {
      this.openLearning()
      return
    }
    if (!action.canEnter) {
      wx.showToast({ title: model.statusDescription || '还没到老师约定的时间', icon: 'none' })
      return
    }
    // 只带邀请 token。直播间自己按上线时间决定是等待还是开场，开场由老师（AI）先开口，
    // 不再替学生预填一句「我们开始吧」——那会变成学生先说话。
    wx.navigateTo({ url: `/pages/diagnosis-room/index?inviteToken=${encodeURIComponent(model.token)}` })
  },

  openLearning() {
    wx.switchTab({ url: '/pages/learning/index' })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/learning/index' })
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
    this.setData({ sheetTransition: false, sheetVisualOffset: offset, sheetTopPx: this._sheetDefaultTop - offset })
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
    this.setData({ sheetTransition: true, sheetVisualOffset: targetOffset, sheetTopPx: this._sheetDefaultTop - targetOffset })
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
  },

  // 转发卡片封面与老师发的那张同一套（services/agent-invite-view.js）。这里没有老师那边的学生称呼：
  // 学生本人转发写自己的昵称，家长（旁听）转发不写名字；也没有年级，胶囊只写学科和时间。
  inviteCover() {
    const invite = (this._payload && this._payload.invite) || {}
    const observer = Boolean(this.data.model && this.data.model.observer)
    return inviteCoverOptions({
      studentName: observer ? '' : (this._viewer && this._viewer.name) || '',
      subject: invite.subject || '',
      scheduledOnlineAt: invite.scheduledOnlineAt || ''
    })
  },

  onShareAppMessage() {
    const model = this.data.model || {}
    if (!model.token) return { title: '知鹿学习', path: '/pages/home/index' }
    const subject = (model.schedule && model.schedule.subjectLabel) || '陪跑'
    const share = {
      title: `${subject}陪跑会议已约好，点进来看看时间`,
      path: `/learning/agent-invite/index?token=${encodeURIComponent(model.token)}`
    }
    return shareWithCover(this, share, this.inviteCover())
  }
})
