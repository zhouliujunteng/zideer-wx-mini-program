const { loadCurrentGrowthCenter, loadPublishedPromotionAssets } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const {
  buildBalance, buildPartnerNotice, buildPosters, keepPosterLayout, splitPosterColumns, matchRatioClass
} = require('../../services/promotion-view')

// 推广伙伴工作台（M52）：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 295f610
// 的 package-promotion/pages/promotion（2026-09-20 同步）。
// 与设计稿的差异（后端口径）：
// - 余额卡改为真实推广奖励金额（元），设计稿的积分口径本后端没有对应账本。
// - 卡片下方三个入口改为真实页面：结算中心 / 我的推广 / 我的邀请码（2026-09-21 随结算三页同步调整，
//   设计稿第三个入口是本地演示的「推广规则」，这里换成真实存在的邀请码页；资格页仍由顶部提示条进入；
//   第三个入口原叫「推广工具」，2026-09-25 按用户要求改叫「我的邀请码」）。
// - 未移植：设计稿右上角切换推广状态的本地调试菜单、签到与做任务卡片（本后端无推广签到与任务）。
// - 2026-09-26 同步设计仓库 847c572：余额卡与「推广海报」标题之间加整幅 AI 海报 banner，进 agent/ai-poster（AI 生成专属海报）。

// 余额卡的标题与说明是固定文案，首屏就显示；金额只在读到真实奖励后显示，之前是骨架。
const { availableValue, lockedValue, ...BALANCE_LABELS } = buildBalance([])
// 海报封面是约两天有效的签名链接：回到本页刷新时沿用旧地址（不重新下载、不闪），
// 但最早那批地址用满 12 小时就整批换成新地址。
const COVER_SRC_REUSE_MS = 12 * 60 * 60 * 1000

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    balance: BALANCE_LABELS,
    statusNotice: {},
    posterColumns: [[], []],
    posterState: 'loading',
    posterEmptyTitle: '',
    posterEmptyCopy: ''
  },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { left: windowWidth - 92, top: (windowInfo.statusBarHeight || 20) + 6, width: 87, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 10
    })
  },

  onShow() {
    return this.loadPage()
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      // 海报对所有登录用户开放（2026-09-21）：后端只按素材的适用范围过滤，
      // 旧版后端返回的 promoter_inactive 仍按「暂无海报」兜底，不再提示开通。
      const [growth, materials] = await Promise.all([
        loadCurrentGrowthCenter(),
        loadPublishedPromotionAssets().catch((error) => ({ status: 'failed', assets: [], error }))
      ])
      if (requestId !== this._loadRequestId) return
      this.setData({
        loadState: 'ready',
        balance: buildBalance(growth.rewards),
        statusNotice: buildPartnerNotice(growth.promoter, 'promotion'),
        ...this.posterData(materials)
      })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '推广伙伴刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  posterData(materials) {
    // 海报已经显示过、这次刷新没读到：保留旧海报，不换成「暂时无法读取」。
    if (materials.status === 'failed' && this.data.posterState === 'ready') return {}
    const now = Date.now()
    const reuseSrc = now - (this._coverSrcSince || 0) < COVER_SRC_REUSE_MS
    if (!reuseSrc) this._coverSrcSince = now
    const shownPosters = [].concat(...this.data.posterColumns)
    const posters = keepPosterLayout(buildPosters(materials.assets), shownPosters, { reuseSrc })
    return { posterColumns: splitPosterColumns(posters), ...this.posterStateData(materials, posters) }
  },

  posterStateData(materials, posters) {
    if (materials.status === 'failed') {
      return { posterState: 'failed', posterEmptyTitle: '海报暂时无法读取', posterEmptyCopy: '请检查网络后返回重进本页。' }
    }
    if (!posters.length) {
      return { posterState: 'empty', posterEmptyTitle: '暂无已发布海报', posterEmptyCopy: '平台发布推广素材后会自动显示在这里。' }
    }
    return { posterState: 'ready', posterEmptyTitle: '', posterEmptyCopy: '' }
  },

  // 封面真实宽高决定卡片比例，避免竖版海报被 3:4 裁切。
  handlePosterLoad(event) {
    const column = Number(event.currentTarget.dataset.column)
    const index = Number(event.currentTarget.dataset.index)
    const detail = event.detail || {}
    const ratioClass = matchRatioClass(detail.width, detail.height)
    const current = this.data.posterColumns[column] && this.data.posterColumns[column][index]
    if (!current || current.ratioClass === ratioClass) return
    this.setData({ [`posterColumns[${column}][${index}].ratioClass`]: ratioClass })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  handleStatusNotice() {
    const url = this.data.statusNotice && this.data.statusNotice.url
    if (url) wx.navigateTo({ url })
  },

  navigate(event) {
    const url = event.currentTarget.dataset.url
    if (url) wx.navigateTo({ url })
  },

  handlePosterTap(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/agent/poster-detail/index?id=${encodeURIComponent(id)}` })
  }
})
