const { loadSettlementApplications } = require('../../services/settlement-service')
const { APPLICATION_TABS, buildApplicationItems, filterApplications } = require('../../services/settlement-apply-view')
const { attachUiAssets } = require('../../services/ui-assets')

// 我的结算记录（2026-09-26，结算中心与奖励结算页进入，界面照结算明细）：
// 一条提现或兑换积分申请一行，显示状态（待处理 / 处理中 / 已打款 / 已驳回 / 已完成）与金额，点进去看详情。
// 与「结算明细」的区别：结算明细是一笔笔推广奖励流水，这里是用户自己发起的结算申请。

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    listHeight: 360,
    tabs: APPLICATION_TABS.map((tab, index) => ({ ...tab, isSelected: index === 0 })),
    activeTabId: 'all',
    items: []
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
    this._windowHeight = windowInfo.windowHeight || 812
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },

  onShow() {
    return this.loadPage()
  },

  onResize(res) {
    const windowHeight = res && res.size && res.size.windowHeight
    if (windowHeight) {
      this._windowHeight = windowHeight
      this.updateListHeight()
    }
  },

  async loadPage() {
    const requestId = (this._loadRequestId || 0) + 1
    this._loadRequestId = requestId
    if (this.data.loadState !== 'ready') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const list = await loadSettlementApplications()
      if (requestId !== this._loadRequestId) return
      this._items = buildApplicationItems(list)
      this.setData({ loadState: 'ready', items: filterApplications(this._items, this.data.activeTabId) }, () => this.updateListHeight())
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '结算记录刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 列表卡片吃满剩余屏高，长列表在卡片内滚动，页面本身不滚。
  updateListHeight() {
    const windowHeight = this._windowHeight
    if (!windowHeight) return
    wx.createSelectorQuery().select('.applications-list-card').boundingClientRect((rect) => {
      if (!rect) return
      const listHeight = Math.max(300, Math.floor(windowHeight - rect.top - 18))
      if (listHeight !== this.data.listHeight) this.setData({ listHeight })
    }).exec()
  },

  handleTab(event) {
    const tabId = String(event.currentTarget.dataset.id || '')
    if (!tabId || tabId === this.data.activeTabId) return
    this.setData({
      activeTabId: tabId,
      tabs: APPLICATION_TABS.map((tab) => ({ ...tab, isSelected: tab.id === tabId })),
      items: filterApplications(this._items, tabId)
    }, () => this.updateListHeight())
  },

  handleOpen(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (id) wx.navigateTo({ url: `/agent/settlement-application/index?id=${encodeURIComponent(id)}` })
  },

  handleWithdraw() {
    wx.navigateTo({ url: '/agent/withdraw/index' })
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/settlement/index' })
  }
})
