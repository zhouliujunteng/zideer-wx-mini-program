const { loadQuestRound, questRound } = require('../../services/identity')
const { normalizeRound, checkpointRows, creditsLine, roundStage, confirmError } = require('../../utils/quest-round-view')
const { openPaymentPage } = require('../../services/payment-switch')
const { rpxToPx } = require('../../utils/screen')

// 续学（2026-11-18 用户要求）：一个目标的课全闯完以后，阶段复测 → 系统按目标出下一轮方案 → 学生在这里确认 → 后台制作。
// 学习页路径末尾「看看方案」「接着制作」「重新排」点进来（?id=<轮次>）。
// 第一次读到前画骨架；正在排课、正在制作时每 4 秒看一次（最多 3 分钟），之后留「刷新」。

const POLL_INTERVAL_MS = 4000
const MAX_POLLS = 45

Page({
  data: {
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    round: null,
    stage: null,
    rows: [],
    credits: '',
    busy: false,
    actionError: '',
    showMembership: false,
    pollStopped: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80
  },

  onLoad(options = {}) {
    this.roundId = /^[1-9][0-9]*$/.test(String(options.id || '')) ? Number(options.id) : 0
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    // 顶栏只在 onLoad 读一次胶囊位置（转屏时读到的可能是旧值）
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(18, windowInfo.windowWidth || 375)
    })
  },

  onShow() {
    this._visible = true
    this._polls = 0
    return this.refresh()
  },

  onHide() {
    this._visible = false
    this.stopPolling()
  },

  onUnload() { this.onHide() },

  stopPolling() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
  },

  async refresh() {
    if (!this.roundId) {
      this.setData({ loadFailed: true, errorMessage: '没有找到这一轮课程，请回学习页再点一次。' })
      return
    }
    try {
      this.apply(await loadQuestRound(this.roundId))
    } catch (error) {
      // 读到过一次就保留旧内容，只提示
      if (this.data.loaded) wx.showToast({ title: (error && error.message) || '暂时没有刷新成功', icon: 'none' })
      else this.setData({ loadFailed: true, errorMessage: (error && error.message) || '下一轮课程暂时读不到，请稍后重试。' })
    }
  },

  apply(raw) {
    const round = normalizeRound(raw)
    const stage = roundStage(round)
    this.setData({
      loaded: true,
      loadFailed: false,
      round,
      stage,
      rows: checkpointRows(round.checkpoint),
      credits: round.status === 'proposed' || round.status === 'blocked' ? creditsLine(round.credits, round.proposal ? round.proposal.lessons.length : 0) : ''
    })
    this.stopPolling()
    if (stage.waiting && this._visible) {
      if ((this._polls || 0) >= MAX_POLLS) {
        this.setData({ pollStopped: true })
        return
      }
      this._polls = (this._polls || 0) + 1
      this._timer = setTimeout(() => this.refresh(), POLL_INTERVAL_MS)
    }
  },

  reload() {
    this.setData({ loadFailed: false, errorMessage: '', pollStopped: false })
    this._polls = 0
    this.refresh()
  },

  async act() {
    const round = this.data.round
    const stage = this.data.stage
    if (!round || !stage || this.data.busy) return
    if (stage.action === 'test') {
      wx.navigateTo({ url: `/learning/goal-diagnosis/index${round.diagnosisId ? `?id=${round.diagnosisId}` : '?autostart=1'}` })
      return
    }
    if (stage.action === 'home') return this.handleBack()
    if (stage.action === 'goal') {
      wx.redirectTo({ url: '/learning/learning-goal/index?mode=new' })
      return
    }
    if (stage.action !== 'confirm' && stage.action !== 'retry') return
    this.setData({ busy: true, actionError: '', showMembership: false })
    try {
      const next = await questRound(stage.action, { id: round.id })
      this._polls = 0
      this.apply(next)
    } catch (error) {
      const result = confirmError(error)
      this.setData({ actionError: result.message, showMembership: result.membership })
    } finally {
      this.setData({ busy: false })
    }
  },

  openMembership() {
    openPaymentPage('/commerce/membership/index', 'membership')
  },

  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
