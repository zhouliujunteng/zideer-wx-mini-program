const { loadCurrentGrowthCenter } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxUnit } = require('../../utils/screen')
const { buildInviteSummary, buildInviteRecords, filterInviteRecords } = require('../../services/settlement-view')

// 我的推广（推广明细）：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 b5dda68
// 的 package-promotion/pages/my-promotion（2026-09-21 同步）。
// 与设计稿的差异（后端口径与隐私边界）：
// - 记录来自真实的学生推广归因摘要（服务端只给昵称、头像、学段、绑定时间、来源与会员状态，
//   不下发学生档案 id、年级、手机号），所以设计稿的年级、注册日期、活跃时间改为学段与绑定日期。
//   2026-09-24 起显示完整昵称与头像（此前脱敏成「X同学」、无头像，推广人认不出是谁）。
// - 会员状态由动作流按已支付会员订单判定（2026-09-21 扩展），前端不再自行推断。
// - 未移植：设计稿右上角「切换列表状态」的本地预览菜单（与工作台、海报详情同样处理）。

const RECORD_TABS = [
  { id: 'member', label: '已加入课程会员' },
  { id: 'non-member', label: '未加入课程会员' }
]

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    recordsHeight: 220,
    title: '我的推广',
    // 人数只在读到真实归因后显示，之前是骨架，这里不放默认 0
    summary: { invitedValue: '', memberValue: '', note: '' },
    recordTabs: RECORD_TABS.map((tab, index) => ({ ...tab, isSelected: index === 0 })),
    activeTabId: 'member',
    visibleRecords: []
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
    this._windowWidth = windowWidth
    this._windowHeight = windowInfo.windowHeight || 812
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18
    })
  },

  onShow() {
    return this.loadPage()
  },

  onResize(res) {
    const windowHeight = res && res.size && res.size.windowHeight
    if (windowHeight) {
      this._windowHeight = windowHeight
      this.updateRecordsHeight()
    }
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const growth = await loadCurrentGrowthCenter()
      if (requestId !== this._loadRequestId) return
      this._records = buildInviteRecords(growth.clients)
      this.setData({
        loadState: 'ready',
        summary: buildInviteSummary(growth.clients),
        visibleRecords: filterInviteRecords(this._records, this.data.activeTabId)
      }, () => this.updateRecordsHeight())
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '我的推广刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 记录不多时卡片按内容收起，记录多时吃满剩余屏高并在卡片内滚动。
  updateRecordsHeight() {
    const windowHeight = this._windowHeight
    if (!windowHeight) return
    const rpx = rpxUnit(this._windowWidth || 375)
    const count = this.data.visibleRecords.length
    const naturalHeight = Math.round((count ? 16 + count * 146 : 220) * rpx)
    wx.createSelectorQuery().select('.my-promotion-records-card').boundingClientRect((rect) => {
      if (!rect) return
      const bottomGap = Math.round(24 * rpx)
      const maxHeight = Math.max(Math.round(160 * rpx), Math.floor(windowHeight - rect.top - bottomGap))
      const recordsHeight = Math.min(naturalHeight, maxHeight)
      if (recordsHeight !== this.data.recordsHeight) this.setData({ recordsHeight })
    }).exec()
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/promotion/index' })
  },

  handleRecordTab(event) {
    const tabId = String(event.currentTarget.dataset.id || '')
    if (!tabId || tabId === this.data.activeTabId) return
    this.setData({
      activeTabId: tabId,
      recordTabs: RECORD_TABS.map((tab) => ({ ...tab, isSelected: tab.id === tabId })),
      visibleRecords: filterInviteRecords(this._records, tabId)
    }, () => this.updateRecordsHeight())
  },

  handleRecordTap(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id) return
    wx.navigateTo({ url: `/agent/client-detail/index?id=${encodeURIComponent(id)}` })
  }
})
