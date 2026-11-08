// 成就卡页（学习页「成就卡 › 全部」，2026-10-13）。数据：课程服务 /api/learn/achievement-cards（services/achievement-cards.js）。
// 2026-10-14 起按系列抽卡：系列标题旁「抽卡 ×N」直接摊扇形抽；点卡片看详情（各级抽中概率、加成进度），也能从详情里抽。
// 抽完关掉浮层时重新读一遍（次数、碎片、点亮情况都以服务端为准）。
// 首次读到前只画骨架；回到本页静默刷新、保留旧数据。?cardId= 进来时读完直接打开那张卡。
const { loadAchievementCards, findSeries } = require('../../services/achievement-cards')
const { getMenuButtonRect } = require('../../utils/screen')

function findCard(model, id) {
  for (const series of (model && model.series) || []) {
    const card = series.cards.find((c) => c.id === id)
    if (card) return card
  }
  return null
}

Page({
  data: {
    loaded: false,
    loadFailed: false,
    loadError: '',
    model: { series: [] },
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    helpRight: 100,
    // 返回、「?」与微信胶囊同高
    buttonSize: 32,
    showRules: false,
    openId: 0,
    openCard: null,
    openSeries: null,
    openMode: 'detail',
    openOrigin: null,
    openLevelId: 0
  },

  onLoad(options = {}) {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menu = getMenuButtonRect(info)
    const statusBarHeight = info.statusBarHeight || 20
    const navigationBarHeight = menu.height + (menu.top - statusBarHeight) * 2
    this._pendingCardId = Number(options.cardId) || 0
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight,
      buttonSize: menu.height,
      // 「?」放在胶囊左边
      helpRight: (info.windowWidth || 375) - menu.left + 8
    })
  },

  onShow() {
    if (this.data.openSeries) return
    this.reload()
  },

  async reload() {
    const version = this._version = (this._version || 0) + 1
    try {
      const model = await loadAchievementCards()
      if (version !== this._version) return
      this.setData({ model, loaded: true, loadFailed: false })
      const pending = this._pendingCardId
      if (pending) {
        this._pendingCardId = 0
        setTimeout(() => this.openById(pending), 120)
      }
    } catch (error) {
      if (version !== this._version || this.data.loaded) return
      this.setData({ loadFailed: true, loadError: error.message || '请稍后再试' })
    }
  },

  noop() {},

  toggleRules() {
    this.setData({ showRules: !this.data.showRules })
  },

  handleBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/learning/index' })
  },

  openCard(e) {
    this.openById(Number(e.currentTarget.dataset.id))
  },

  openById(id) {
    const card = findCard(this.data.model, id)
    if (!card || this.data.openSeries) return
    const series = findSeries(this.data.model, card.seriesId)
    wx.createSelectorQuery()
      .select(`#ac-card-${id} .ac-card`)
      .boundingClientRect((rect) => {
        // 先让浮层接管，再把格子里那张藏起来（看起来就是这张卡飞出去了）
        this.setData({ openCard: card, openSeries: series, openMode: 'detail', openOrigin: rect || null, openLevelId: 0, openId: id })
      })
      .exec()
  },

  // 系列标题旁的「抽卡」：直接摊扇形；没有次数时说一下怎么拿
  drawSeries(e) {
    const series = findSeries(this.data.model, Number(e.currentTarget.dataset.id))
    if (!series || this.data.openSeries) return
    if (!series.drawsTotal) {
      wx.showToast({ title: series.task ? series.task.text : '完成任务获得抽卡次数', icon: 'none' })
      return
    }
    this.setData({ openCard: null, openSeries: series, openMode: 'draw', openOrigin: null, openLevelId: 0, openId: 0 })
  },

  openShop() {
    wx.navigateTo({ url: '/learning/card-fragments/index' })
  },

  handleDrawn() {
    this._drawn = true
  },

  handleRevealClose() {
    this.setData({ openCard: null, openSeries: null, openOrigin: null, openId: 0 })
    if (this._drawn) {
      this._drawn = false
      this.reload()
    }
  }
})
