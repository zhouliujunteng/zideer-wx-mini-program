// 学习天梯榜（2026-11-17 用户要求）：今天全站谁学了多久、闯过多少关；先比闯关数再比时长；
// 每天 24 点结算，前三名各得 100 金币。名字由服务端打码（自己那一行全名）。
// 数据：课程服务 /api/learn/ladder（规则 lib/course/ladder.ts，学生网页端 /portal/ladder 同一份），页面模型 utils/ladder-view.js。
// 第一次读到前只画骨架；回到本页、每 30 秒静默刷新、保留旧数据；第一次就读不到给重试。倒计时每秒走，按服务器时间校准。
const { loadLadder } = require('../../services/identity')
const { getNavigationMetrics } = require('../../utils/navigation')
const { normalizeLadder, ladderView, countdownText } = require('../../utils/ladder-view')

const REFRESH_MS = 30000

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    loaded: false,
    loadFailed: false,
    loadError: '',
    view: null,
    countdown: '--:--:--'
  },

  onLoad() {
    const metrics = getNavigationMetrics()
    this.setData({ ...metrics, contentTop: metrics.statusBarHeight + metrics.navigationBarHeight })
  },

  onShow() {
    this.load()
    this.stopTimers()
    this._refresh = setInterval(() => this.load(), REFRESH_MS)
    this._tick = setInterval(() => this.tick(), 1000)
  },

  onHide() {
    this.stopTimers()
  },

  onUnload() {
    this.stopTimers()
  },

  stopTimers() {
    if (this._refresh) clearInterval(this._refresh)
    if (this._tick) clearInterval(this._tick)
    this._refresh = null
    this._tick = null
  },

  tick() {
    if (!this._settleAt) return
    const countdown = countdownText(this._settleAt, Date.now(), this._offset)
    if (countdown !== this.data.countdown) this.setData({ countdown })
    // 过了 24 点：重新读一次，换成新的一天和昨天的结果
    if (countdown === '00:00:00' && !this._rolled) {
      this._rolled = true
      setTimeout(() => this.load(), 3000)
    }
  },

  async load() {
    if (this._loading) return
    this._loading = true
    try {
      const ladder = normalizeLadder(await loadLadder())
      if (!ladder) throw new Error('天梯榜暂时读不到，请稍后重试。')
      this._settleAt = ladder.settleAt
      this._offset = (Date.parse(ladder.now) || Date.now()) - Date.now()
      this._rolled = false
      this.setData({
        view: ladderView(ladder),
        countdown: countdownText(this._settleAt, Date.now(), this._offset),
        loaded: true,
        loadFailed: false,
        loadError: ''
      })
    } catch (error) {
      if (!this.data.loaded) this.setData({ loadFailed: true, loadError: (error && error.message) || '天梯榜暂时读不到，请稍后重试。' })
    } finally {
      this._loading = false
    }
  },

  retry() {
    this.setData({ loadFailed: false })
    this.load()
  },

  openLearning() {
    wx.switchTab({ url: '/pages/learning/index' })
  },

  handleBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/learning/index' }) })
  }
})
