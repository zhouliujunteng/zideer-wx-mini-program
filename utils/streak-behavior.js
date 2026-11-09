const { getStreakState, subscribeStreak, refreshStreak } = require('../services/learning-streak')
const { attachUiAssets } = require('../services/ui-assets')
const { guardAccess } = require('./access-gate')

// 学习连胜入口（streak-entry、streak-card）共用：订阅共享打卡状态，页面每次显示时重新读取。
// 还没点亮时，页面停留期间隔一会儿再读一次：刚学完一节课回到页面时打卡可能还在推送
// （课程服务当场推不成会每 30 秒补送），第二次读取就能点亮，不用来回切页面。
const RECHECK_MS = 35 * 1000

module.exports = Behavior({
  data: { streakStatus: 'loading', streak: null },

  lifetimes: {
    attached() {
      attachUiAssets(this)
      this._streakVisible = true
      this.applyStreakState(getStreakState())
      this._streakUnsubscribe = subscribeStreak((state) => this.applyStreakState(state))
      this.refreshStreakState()
    },
    detached() {
      this._streakVisible = false
      this.clearStreakRecheck()
      if (this._streakUnsubscribe) this._streakUnsubscribe()
      this._streakUnsubscribe = null
    }
  },

  pageLifetimes: {
    show() {
      this._streakVisible = true
      this.refreshStreakState()
    },
    hide() {
      this._streakVisible = false
      this.clearStreakRecheck()
    }
  },

  methods: {
    applyStreakState(state) {
      this.setData({ streakStatus: state.status, streak: state.summary })
    },

    refreshStreakState() {
      // 跨过零点或换了账号时，先回到骨架，不显示过期的点亮状态。
      this.applyStreakState(getStreakState())
      this.clearStreakRecheck()
      // 首次显示时 attached 与 show 各调一次（请求在服务里合并），只让最后一次安排复查。
      const generation = this._streakGeneration = (this._streakGeneration || 0) + 1
      return refreshStreak().then((state) => {
        if (generation !== this._streakGeneration) return
        if (!this._streakVisible || state.status !== 'ready' || state.summary.lit) return
        this._streakRecheck = setTimeout(() => {
          this._streakRecheck = null
          if (this._streakVisible) refreshStreak()
        }, RECHECK_MS)
      })
    },

    clearStreakRecheck() {
      if (this._streakRecheck) clearTimeout(this._streakRecheck)
      this._streakRecheck = null
    },

    openCheckIn() {
      // 游客先登录，没建档的先完善学习资料（2026-09-27 起未登录也能浏览）
      if (guardAccess(this.data.streakStatus, '完善学习资料后就能记录学习连胜。')) return
      wx.navigateTo({ url: '/learning/check-in/index' })
    }
  }
})
