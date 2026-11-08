const { loadCurrentGrowthCenter, loadMeDashboard, loadCurrentServiceContacts } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { openCustomerServiceChat, customerServiceErrorMessage } = require('../../utils/customer-service')
const { buildPartnerNotice } = require('../../services/promotion-view')
const {
  buildSettlementSummary, buildGiftAccount, buildRecords, groupRecordsByMonth, buildRules
} = require('../../services/settlement-view')

// 结算中心（M52-Settlement）：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 b5dda68
// 的 package-promotion/pages/settlement（2026-09-21 同步）。
// 与设计稿的差异（后端口径）：
// - 设计稿的「可提现 / 待入账 / 提现中 / 已提现 / 立即提现」在本后端没有对应表（推广侧没有提现申请，
//   金币提现是另一条账本），改为真实的「可选择奖励」与待解锁 / 已转现金 / 已转积分三项分类金额。
// - 「整笔转现金」2026-09-26 起进二级页「奖励结算」（agent/withdraw）：开通推广伙伴的整笔提现到银行卡，
//   没开通的可以整笔兑换课程积分。卡片下方加「我的结算记录」入口（agent/settlement-applications）。
// - 「提现需开通推广伙伴」提示条点击进「申请成为推广伙伴」页（2026-09-29 起在小程序申请、后台审核开通）。
// - 未移植：设计稿的提现金额弹层（提现是整笔，不输金额）、本地刷新胶囊的假数据刷新（改为真实重新拉取）。
// - 设计稿之外（用户 2026-09-21 要求）：顶部显示真实头像，底部加企业微信客服入口。
//   头像与客服入口都是「有就显示、读失败就降级」，不阻塞结算数据本身。

const RECENT_RECORD_LIMIT = 5

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    refreshTop: 88,
    isScrolled: false,
    topbarProgress: 0,
    topbarWhiteOpacity: 1,
    isRefreshing: false,
    title: '结算中心',
    // 头像、昵称和金额只在读到真实数据后显示，之前是骨架；卡片标题等固定文案在 onLoad 里就填好
    profile: { name: '', initial: '', avatarUrl: '' },
    summary: {},
    giftAccount: { visible: false },
    statusNotice: {},
    recordGroups: [],
    rules: {},
    serviceContact: null,
    serviceMeta: '',
    serviceOpening: false
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
      contentTop: statusBarHeight + navigationBarHeight + 18,
      refreshTop: statusBarHeight + navigationBarHeight + 8,
      rules: buildRules(),
      // 只取标题文案；金额位在 loadState 就绪前由骨架占住，不会显示这里的 0.00
      summary: buildSettlementSummary([])
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
      // 头像与企微客服入口读失败都只降级显示，不影响结算数据。
      const [growth, dashboard, service] = await Promise.all([
        loadCurrentGrowthCenter(),
        loadMeDashboard().catch(() => null),
        loadCurrentServiceContacts().catch(() => ({ status: 'failed', contacts: [] }))
      ])
      if (requestId !== this._loadRequestId) return
      const records = buildRecords(growth.rewards, growth.recoveries)
      const promoter = growth.promoter || null
      const student = growth.student || {}
      const dashboardProfile = dashboard && dashboard.profile || {}
      const name = String(promoter && promoter.display_name || dashboardProfile.displayName || student.nickname || '推广伙伴')
      const contact = (service && service.contacts || [])[0] || null
      this.setData({
        loadState: 'ready',
        profile: {
          name,
          initial: String(dashboardProfile.initial || name.slice(0, 1)),
          avatarUrl: String(dashboardProfile.avatarUrl || '')
        },
        summary: buildSettlementSummary(growth.rewards),
        giftAccount: buildGiftAccount(growth.giftAccount),
        statusNotice: buildPartnerNotice(promoter, 'settlement'),
        recordGroups: groupRecordsByMonth(records.slice(0, RECENT_RECORD_LIMIT)),
        serviceContact: contact,
        serviceMeta: contact ? `企业微信 · ${contact.title}` : '暂无可用入口，可去真人服务页查看'
      })
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '结算中心刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 顶栏白字随资料卡滚出视口渐变为深色，记录少、滚动距离短时也准确。
  handleScroll() {
    if (this._topbarQueryPending) return
    this._topbarQueryPending = true
    wx.createSelectorQuery()
      .select('.settlement-profile')
      .boundingClientRect((profileRect) => {
        this._topbarQueryPending = false
        if (!profileRect || !profileRect.height) return
        const topbarBottom = this.data.statusBarHeight + this.data.navigationBarHeight
        const progress = Math.min(1, Math.max(0, (topbarBottom - profileRect.top) / profileRect.height))
        const topbarProgress = Number(progress.toFixed(2))
        const topbarWhiteOpacity = Number((1 - progress).toFixed(2))
        const isScrolled = progress >= 1
        if (
          topbarProgress !== this.data.topbarProgress ||
          topbarWhiteOpacity !== this.data.topbarWhiteOpacity ||
          isScrolled !== this.data.isScrolled
        ) {
          this.setData({ isScrolled, topbarProgress, topbarWhiteOpacity })
        }
      })
      .exec()
  },

  async handleRefresh() {
    if (this.data.isRefreshing) return
    this.setData({ isRefreshing: true })
    try {
      await this.loadPage()
    } finally {
      this.setData({ isRefreshing: false })
    }
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/promotion/index' })
  },

  handleViewAll() {
    wx.navigateTo({ url: '/agent/settlement-records/index' })
  },

  // 提现需开通推广伙伴：进「申请成为推广伙伴」页（基础核验 → 提交申请，2026-09-29）；资格异常的直接找客服。
  handleStatusNotice() {
    const notice = this.data.statusNotice || {}
    if (notice.action === 'service') return this.handleService()
    if (notice.url) wx.navigateTo({ url: notice.url })
  },

  // 整笔转现金：二级页里再选「提现到银行卡」或「兑换课程积分」，金额与税费都由服务端算。
  handleElection() {
    wx.navigateTo({ url: '/agent/withdraw/index' })
  },

  handleApplications() {
    wx.navigateTo({ url: '/agent/settlement-applications/index' })
  },

  // 企微客服：拿到有效入口就直接拉起会话，没有就去真人服务页（那里会说明原因）。
  async handleService() {
    if (this.data.serviceOpening) return
    const contact = this.data.serviceContact
    if (!contact) {
      wx.navigateTo({ url: '/account/service-contact/index' })
      return
    }
    this.setData({ serviceOpening: true })
    try {
      await openCustomerServiceChat(contact)
    } catch (error) {
      wx.showToast({ title: customerServiceErrorMessage(error), icon: 'none' })
    } finally {
      this.setData({ serviceOpening: false })
    }
  }
})
