const { attachPaymentSwitch, knownPaymentOpen } = require('../../services/payment-switch')
const { hasSession } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { openLogin } = require('../../utils/access-gate')
const { readAccountType } = require('../../utils/account-role')
const { rpxToPx, getMenuButtonRect } = require('../../utils/screen')
const content = require('../help-center/content')
const { prepareShareCover } = require('../../services/share-cover')
const { guideCoverText } = require('../../utils/share-cover')

// 操作指南（帮助与反馈 → 操作指南 → 某一份，?id=）：分步图解 + 点按动画，底部按钮带用户去实际操作的地方。
// 指南内容在 account/help-center/content.js；会员与付款相关的指南在支付开关关着时当作不存在。
//
// 分享（2026-10-04 用户要求）：顶栏胶囊左边的分享按钮 → 分享面板：
// - 「发给好友」：转发小程序卡片，封面是本页用画布现画的（utils/share-cover.js：千问底图 + 知鹿学习 Logo + 指南图标 + 标题），打开直接进这份指南；
// - 「复制链接」：小程序没有生成链接的接口，提示用户点胶囊「···」→「复制链接」。复制出来的链接打开的是
//   「当前页 + 当前页的查询串」（见 agent/share-link），所以带着 ?id= 就直达这份指南；页面要定义转发，菜单里才有复制链接。

// 示意底栏与小程序底栏同样几项：家长没有「图谱」（custom-tab-bar）
const TABS = [
  { key: 'home', label: '首页' },
  { key: 'learning', label: '学习' },
  { key: 'universe', label: '宇宙' },
  { key: 'map', label: '图谱', studentOnly: true },
  { key: 'me', label: '我的' }
]
const COPY_HINT_MS = 8000

function tabItems(figure, accountType) {
  if (!figure || !figure.tab) return null
  return TABS
    .filter((tab) => !(tab.studentOnly && accountType === 'guardian'))
    .map((tab) => ({
      key: tab.key,
      label: tab.label,
      active: figure.tab === tab.key && !figure.hotTab,
      hot: figure.tab === tab.key && Boolean(figure.hotTab),
      tag: figure.tabTag || ''
    }))
}

// 封面：底图、Logo 固定（utils/share-cover.js），图标用这份指南自己的 3D 图标
function coverOptions(guide) {
  return { iconKey: content.guideIconPath(guide.id), text: guideCoverText(guide) }
}

function viewGuide(guide, accountType) {
  return {
    ...guide,
    iconPath: content.guideIconPath(guide.id),
    steps: guide.steps.map((step) => ({
      ...step,
      figure: step.figure ? { ...step.figure, tabItems: tabItems(step.figure, accountType) } : null
    }))
  }
}

function shareTitleOf(guide) {
  return guide ? `${guide.title}｜知鹿学习操作指南` : '帮助与反馈｜知鹿学习'
}

function sharePathOf(guide) {
  return guide ? `/account/help-guide/index?id=${guide.id}` : '/account/help-center/index'
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    guide: null,
    relatedFaqs: [],
    openFaqId: '',
    paymentOpen: false,
    shareButtonTop: 28,
    shareButtonRight: 98,
    shareButtonSize: 32,
    shareVisible: false,
    shareTitle: '',
    // 分享卡片封面（画好之前分享面板里画骨架）
    coverPath: '',
    copyHintVisible: false,
    // 往下滑之后顶栏换成浅色底
    topbarSolid: false,
    pointerLeft: 0,
    pointerTop: 0
  },
  onLoad(options = {}) {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const statusBarHeight = windowInfo.statusBarHeight || 20
    // 胶囊位置只在这里读一次（转屏那一刻读到的可能是旧值，AGENTS.md 大屏适配）
    const menuButton = getMenuButtonRect(windowInfo)
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this._guideId = String(options.id || '')
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowWidth),
      paymentOpen: knownPaymentOpen(),
      shareButtonTop: menuButton.top + Math.max(0, (menuButton.height - 32) / 2),
      shareButtonRight: Math.max(8, windowWidth - menuButton.left + 8),
      shareButtonSize: Math.min(32, menuButton.height),
      pointerLeft: Math.round(menuButton.left + menuButton.width / 4),
      pointerTop: Math.round(menuButton.top + menuButton.height + 6)
    })
    this.loadGuide()
  },
  onReady() {
    this._ready = true
    this.renderCover()
  },
  onShow() {
    const before = this.data.paymentOpen
    attachPaymentSwitch(this).then(() => {
      if (this.data.paymentOpen !== before) this.loadGuide()
    })
  },
  onHide() { this.hideCopyHint() },
  onUnload() { this.hideCopyHint() },
  loadGuide() {
    const scope = { paymentOpen: this.data.paymentOpen, accountType: readAccountType() }
    const guide = content.visibleGuides(scope).find((item) => item.id === this._guideId) || null
    const relatedFaqs = guide ? content.visibleFaqs(scope).filter((faq) => faq.guide === guide.id).map((faq) => ({ id: faq.id, title: faq.title, answer: faq.answer })) : []
    this.setData({ guide: guide ? viewGuide(guide, scope.accountType) : null, relatedFaqs, shareTitle: shareTitleOf(guide) })
    if (this._ready) this.renderCover()
  },
  // 用页面里藏起来的 2d 画布画封面，导出成本地图片给分享卡片用；同一份指南只画一次（services/share-cover.js）
  renderCover() {
    const guide = this.data.guide
    if (!guide) return Promise.resolve('')
    return prepareShareCover(this, coverOptions(guide)).then((path) => {
      const current = this.data.guide
      if (!path || !current || current.id !== guide.id) return ''
      if (this.data.coverPath !== path) this.setData({ coverPath: path })
      return path
    })
  },
  openShare() {
    if (!this.data.guide) return
    this.hideCopyHint()
    this.setData({ shareVisible: true })
    this.renderCover()
  },
  closeShare() { this.setData({ shareVisible: false }) },
  noop() {},
  handleScroll(event) {
    const solid = event.detail.scrollTop > 12
    if (solid !== this.data.topbarSolid) this.setData({ topbarSolid: solid })
  },
  // 复制链接：关掉面板，在胶囊「···」下面指一下；安卓上再兜一层，确保复制出来的只带指南编号
  showCopyHint() {
    const guide = this.data.guide
    this.setData({ shareVisible: false, copyHintVisible: true })
    if (guide && wx.onCopyUrl && !this._copyUrlHandler) {
      this._copyUrlHandler = () => ({ query: `id=${guide.id}` })
      wx.onCopyUrl(this._copyUrlHandler)
    }
    clearTimeout(this._copyHintTimer)
    this._copyHintTimer = setTimeout(() => this.setData({ copyHintVisible: false }), COPY_HINT_MS)
  },
  hideCopyHint() {
    clearTimeout(this._copyHintTimer)
    if (this.data.copyHintVisible) this.setData({ copyHintVisible: false })
    if (this._copyUrlHandler && wx.offCopyUrl) wx.offCopyUrl(this._copyUrlHandler)
    this._copyUrlHandler = null
  },
  // 转发卡片：打开直接进这份指南；封面还没画好时交给 promise，3 秒内画好就用，否则用微信默认截图
  onShareAppMessage() {
    const guide = this.data.guide
    const share = { title: shareTitleOf(guide), path: sharePathOf(guide) }
    if (!guide) return share
    if (this.data.coverPath) return { ...share, imageUrl: this.data.coverPath }
    return { ...share, promise: this.renderCover().then((imageUrl) => (imageUrl ? { ...share, imageUrl } : share)) }
  },
  toggleFaq(event) {
    const id = String(event.currentTarget.dataset.id || '')
    this.setData({ openFaqId: this.data.openFaqId === id ? '' : id })
  },
  // 去实际操作：tab 页直接切过去（各 tab 页自己处理游客、没完善资料）；其余页面要登录的先登录
  startAction() {
    const action = this.data.guide && this.data.guide.action
    if (!action) return
    if (action.tab) return wx.switchTab({ url: action.tab })
    if (action.login && !hasSession()) return openLogin()
    if (action.url) wx.navigateTo({ url: action.url })
  },
  openFeedback() {
    wx.navigateTo({ url: '/account/help-feedback/index' })
  },
  // 从分享卡片、链接直接打开时没有上一页：返回、找不到指南都回帮助与反馈
  openHelpCenter() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/account/help-center/index' })
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.redirectTo({ url: '/account/help-center/index' })
  }
})
