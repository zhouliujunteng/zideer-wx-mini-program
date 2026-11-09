const { loadOrders } = require('../../services/identity')
const { orderTabsFor, groupOrdersByMonth } = require('../order-view')

// 订单记录：设计仓库没有订单页，整页照设计师的「结算明细」（package-promotion/pages/settlement-records）：
// 顶栏、筛选页签、占满剩余屏高的列表卡、按月分组；每条订单用课程积分明细（M34）的三行条目，带状态标签。
Page({
  // 第一次读到订单前显示骨架；读到过一次后回到页面保留旧列表，后台静默刷新。
  data: {
    loaded: false,
    failed: false,
    activeTabId: 'all',
    orderTabs: orderTabsFor('all'),
    recordGroups: [],
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    recordsHeight: 360
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this._windowHeight = windowInfo.windowHeight || 812
    this._orders = []
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
  },
  onShow() { return this.loadPage() },
  onResize(res) {
    const windowHeight = res && res.size && res.size.windowHeight
    if (windowHeight) {
      this._windowHeight = windowHeight
      this.updateRecordsHeight()
    }
  },
  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    try {
      const orders = await loadOrders()
      this._orders = orders || []
      this.setData({ loaded: true, recordGroups: groupOrdersByMonth(this._orders, this.data.activeTabId) }, () => this.updateRecordsHeight())
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      else wx.showToast({ title: error.message || '订单刷新失败', icon: 'none' })
    }
  },
  // 列表卡吃满剩余屏高，长列表在卡片内滚动，页面本身不滚（与结算明细一致）。
  updateRecordsHeight() {
    const windowHeight = this._windowHeight
    if (!windowHeight || !wx.createSelectorQuery) return
    wx.createSelectorQuery().select('.orders-list-card').boundingClientRect((rect) => {
      if (!rect) return
      const recordsHeight = Math.max(300, Math.floor(windowHeight - rect.top - 18))
      if (recordsHeight !== this.data.recordsHeight) this.setData({ recordsHeight })
    }).exec()
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  handleTab(event) {
    const tabId = String(event.currentTarget.dataset.id || '')
    if (!tabId || tabId === this.data.activeTabId) return
    this.setData({ activeTabId: tabId, orderTabs: orderTabsFor(tabId), recordGroups: groupOrdersByMonth(this._orders, tabId) }, () => this.updateRecordsHeight())
  },
  openOrder(event) {
    wx.navigateTo({ url: `/commerce/order-detail/index?orderId=${encodeURIComponent(event.currentTarget.dataset.id)}` })
  }
})
