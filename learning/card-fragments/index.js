// 碎片商店（成就卡，2026-10-14）：碎片换通用抽卡次数（任何系列都能用）。数据：课程服务 /api/learn/achievement-cards。
// 兑换动画：碎片从展台飞到屏幕中间 → 拼成一张卡背、抖一下 → 翻面变成「通用抽卡 +1」，撒纸屑、重震。
// 服务端在点「兑换」时就开始兑，动画走完再按结果显示；失败就收起动画提示原因。
const { loadAchievementCards, exchangeFragments } = require('../../services/achievement-cards')
const { getMenuButtonRect, rpxToPx } = require('../../utils/screen')
const { burstConfetti } = require('../../utils/confetti')

const SHARDS = 14
const GATHER_MS = 720
const FORGE_MS = 520
const FLIP_MS = 460

function buzz(type) {
  try {
    if (wx.vibrateShort) wx.vibrateShort({ type, fail() {} })
  } catch (error) {}
}

function derive(model) {
  const cost = model.exchangeCost || 60
  return {
    canExchange: model.fragments >= cost,
    exchangeTimes: Math.floor(model.fragments / cost),
    needMore: cost - (model.fragments % cost),
    progress: model.fragments >= cost ? 100 : Math.round((model.fragments / cost) * 100)
  }
}

Page({
  data: {
    loaded: false,
    loadFailed: false,
    loadError: '',
    model: { fragments: 0, exchangeCost: 60, duplicateFragments: 10, bonusDraws: 0 },
    canExchange: false,
    exchangeTimes: 0,
    needMore: 60,
    progress: 0,
    busy: false,
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    buttonSize: 32,
    fx: false,
    fxMask: false,
    fxStage: '',
    fxFlipped: false,
    fxLeft: 0,
    fxTop: 0,
    fxWidth: 0,
    fxHeight: 0,
    shards: []
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menu = getMenuButtonRect(info)
    const statusBarHeight = info.statusBarHeight || 20
    const navigationBarHeight = menu.height + (menu.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight, buttonSize: menu.height })
  },

  onShow() {
    if (!this.data.fx) this.reload()
  },

  onUnload() {
    ;(this._timers || []).forEach(clearTimeout)
  },

  timer(fn, ms) {
    this._timers = this._timers || []
    this._timers.push(setTimeout(fn, ms))
  },

  async reload() {
    const version = this._version = (this._version || 0) + 1
    try {
      const model = await loadAchievementCards()
      if (version !== this._version) return
      this.setData({ model, ...derive(model), loaded: true, loadFailed: false })
    } catch (error) {
      if (version !== this._version || this.data.loaded) return
      this.setData({ loadFailed: true, loadError: error.message || '请稍后再试' })
    }
  },

  noop() {},

  handleBack() {
    if (getCurrentPages().length > 1) wx.navigateBack({ delta: 1 })
    else wx.redirectTo({ url: '/learning/achievement-cards/index' })
  },

  openCards() {
    const pages = getCurrentPages()
    const prev = pages[pages.length - 2]
    // 从成就卡页进来的就回去，不然打开成就卡页
    if (prev && prev.route === 'learning/achievement-cards/index') wx.navigateBack({ delta: 1 })
    else wx.redirectTo({ url: '/learning/achievement-cards/index' })
  },

  exchange() {
    if (!this.data.canExchange || this.data.busy || this.data.fx) return
    buzz('medium')
    this._result = exchangeFragments().then((value) => ({ value }), (error) => ({ error }))
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const ww = info.windowWidth || 375
    const wh = info.windowHeight || 667
    const width = Math.min(rpxToPx(400, ww), ww * 0.56)
    const height = width * 1.4
    const left = (ww - width) / 2
    const top = Math.max(this.data.contentTop + 20, (wh - height) / 2 - rpxToPx(120, ww))
    wx.createSelectorQuery().select('#fs-gems').boundingClientRect((rect) => {
      const from = rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: ww / 2, y: top }
      const to = { x: ww / 2, y: top + height / 2 }
      const shards = Array.from({ length: SHARDS }, (_, i) => {
        const angle = (i / SHARDS) * Math.PI * 2
        const r = 24 + Math.random() * 36
        const x = from.x + Math.cos(angle) * r - 7
        const y = from.y + Math.sin(angle) * r - 7
        return { id: i, from: { x, y }, style: `left: ${x}px; top: ${y}px; opacity: 0; transform: rotate(45deg) scale(0.4);` }
      })
      this.setData({ busy: true, fx: true, fxMask: false, fxStage: 'fs-hidden', fxFlipped: false, fxLeft: left, fxTop: top, fxWidth: width, fxHeight: height, shards }, () => {
        this.timer(() => {
          // 碎片飞向中间（错开出发），一边转一边变小
          this.setData({
            fxMask: true,
            shards: shards.map((s) => ({
              ...s,
              style: `left: ${s.from.x}px; top: ${s.from.y}px; opacity: 1; transform: translate(${(to.x - 7 - s.from.x).toFixed(1)}px, ${(to.y - 7 - s.from.y).toFixed(1)}px) rotate(${405 + s.id * 20}deg) scale(0.9);
                transition: transform ${GATHER_MS}ms cubic-bezier(0.55, 0, 0.3, 1) ${s.id * 22}ms, opacity 200ms ease ${s.id * 22}ms;`
            }))
          })
          this.timer(() => this.forge(), GATHER_MS + SHARDS * 22)
        }, 40)
      })
    }).exec()
  },

  // 碎片拼成一张卡背，抖一抖
  forge() {
    buzz('light')
    this.setData({ shards: this.data.shards.map((s) => ({ ...s, style: s.style.replace(/opacity: 1;/, 'opacity: 0;') })), fxStage: 'fs-forge' })
    this.timer(() => this.flip(), FORGE_MS)
  },

  async flip() {
    const outcome = await this._result
    if (outcome.error) {
      this.setData({ fx: false, busy: false, shards: [] })
      wx.showToast({ title: outcome.error.message || '兑换没成功，请稍后再试', icon: 'none' })
      this.reload()
      return
    }
    const model = { ...this.data.model, fragments: outcome.value.fragments, bonusDraws: outcome.value.bonusDraws }
    buzz('heavy')
    this.setData({ fxFlipped: true, fxStage: 'fs-flip', model, ...derive(model) })
    burstConfetti(this, '#fs-confetti', { x: this.data.fxLeft + this.data.fxWidth / 2, y: this.data.fxTop + this.data.fxHeight * 0.2, spread: this.data.fxWidth * 0.5 }, () => this.data.fx)
    this.timer(() => this.setData({ fxStage: 'fs-done', busy: false }), FLIP_MS + 120)
  },

  closeFx() {
    if (this.data.fxStage !== 'fs-done') return
    this.setData({ fx: false, fxMask: false, shards: [], fxStage: '' })
  }
})
