// 我的荣誉第二版（2026-11-13 用户要求）：奖杯和勋章脱离课程内容、全站统一——奖杯 3 座各 4 级（闯关杯 / 勤学杯 / 恒心杯），
// 勋章 9 枚分 4 组；参照小米汽车「我的勋章」：浅色干净的页面，没拿到的是压灰的同一张图，点开整页详情，拿到的能随手机转动、反光。
// 数据：课程服务 /api/learn/honors?honors=2（规则 lib/course/honors-v2.ts），页面模型 utils/honors-view.js，图在 ui_asset 的 honors/v2/*.png。
// 第一次读到前只画骨架；回到本页静默刷新、保留旧数据；第一次就读不到给重试。
// 本机没看过的荣誉标「新」，看过 1.5 秒后记为看过（学习页的庆祝弹层也用同一份记录）。
const { loadHonors } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { getNavigationMetrics } = require('../../utils/navigation')
const { normalizeHonors, honorsView, findHonor, readSeen, markSeen } = require('../../utils/honors-view')

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 64,
    loaded: false,
    loadFailed: false,
    loadError: '',
    view: null,
    detail: null,
    skeletonCups: [0, 1, 2],
    skeletonMedals: [0, 1, 2, 3, 4, 5]
  },

  onLoad() {
    const metrics = getNavigationMetrics()
    this.setData({ ...metrics, contentTop: metrics.statusBarHeight + metrics.navigationBarHeight })
    attachUiAssets(this)
  },

  onShow() {
    this.load()
  },

  onHide() {
    if (this._seenTimer) clearTimeout(this._seenTimer)
    this._seenTimer = null
  },

  onUnload() {
    this.onHide()
  },

  async load() {
    if (this._loading) return
    this._loading = true
    try {
      const honors = normalizeHonors(await loadHonors())
      if (!honors) throw new Error('荣誉暂时读不到，请稍后重试。')
      this._honors = honors
      this.setData({ view: honorsView(honors, readSeen()), loaded: true, loadFailed: false, loadError: '' })
      // 看过一会儿再记为看过：这次「新」标记照常显示
      if (this._seenTimer) clearTimeout(this._seenTimer)
      this._seenTimer = setTimeout(() => { this._seenTimer = null; markSeen(honors) }, 1500)
    } catch (error) {
      // 读到过就保留旧数据，只有第一次读不到才显示错误
      if (!this.data.loaded) this.setData({ loadFailed: true, loadError: (error && error.message) || '荣誉暂时读不到，请稍后重试。' })
    } finally {
      this._loading = false
    }
  },

  retry() {
    this.setData({ loadFailed: false })
    this.load()
  },

  openHonor(event) {
    const item = findHonor(this.data.view, String(event.currentTarget.dataset.id || ''))
    if (!item) return
    try { wx.vibrateShort({ type: 'light' }) } catch (error) { /* 没有震动也照常 */ }
    this.setData({ detail: { ...item.detail, art: item.art, kind: item.kind, earned: item.earned, level: item.level } })
  },

  closeHonor() {
    this.setData({ detail: null })
  },

  noop() {},

  handleBack() {
    wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/learning/index' }) })
  },

  openLearning() {
    wx.switchTab({ url: '/pages/learning/index' })
  }
})
