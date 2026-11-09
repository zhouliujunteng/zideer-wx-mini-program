const { loadCurrentGrowthCenter } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { buildRecords, filterRecords, groupRecordsByMonth } = require('../../services/settlement-view')

// 结算明细：界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 b5dda68
// 的 package-promotion/pages/settlement-records（2026-09-21 同步）。
// 明细来自真实的推广奖励流水与奖励追偿记录：待结算 = 待解锁 + 可选择，
// 已结算 = 已转现金 + 已转积分 + 已追回，与 P2D-06 的奖励状态机一致。

const RECORD_TABS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待结算' },
  { id: 'settled', label: '已结算' }
]

Page({
  data: {
    loadState: 'loading',
    loadError: '',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    recordsHeight: 360,
    recordTabs: RECORD_TABS.map((tab, index) => ({ ...tab, isSelected: index === 0 })),
    activeTabId: 'all',
    recordGroups: []
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
      this._records = buildRecords(growth.rewards, growth.recoveries)
      this.setData({
        loadState: 'ready',
        recordGroups: groupRecordsByMonth(filterRecords(this._records, this.data.activeTabId))
      }, () => this.updateRecordsHeight())
    } catch (error) {
      if (requestId !== this._loadRequestId) return
      if (this.data.loadState === 'ready') {
        wx.showToast({ title: error.message || '结算明细刷新失败', icon: 'none' })
        return
      }
      this.setData({ loadState: 'failed', loadError: error.message || '请稍后重试。' })
    }
  },

  // 列表卡片吃满剩余屏高，长列表在卡片内滚动，页面本身不滚。
  updateRecordsHeight() {
    const windowHeight = this._windowHeight
    if (!windowHeight) return
    wx.createSelectorQuery().select('.settlement-records-list-card').boundingClientRect((rect) => {
      if (!rect) return
      const recordsHeight = Math.max(300, Math.floor(windowHeight - rect.top - 18))
      if (recordsHeight !== this.data.recordsHeight) this.setData({ recordsHeight })
    }).exec()
  },

  handleBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.navigateTo({ url: '/agent/settlement/index' })
  },

  handleRecordTab(event) {
    const tabId = String(event.currentTarget.dataset.id || '')
    if (!tabId || tabId === this.data.activeTabId) return
    this.setData({
      activeTabId: tabId,
      recordTabs: RECORD_TABS.map((tab) => ({ ...tab, isSelected: tab.id === tabId })),
      recordGroups: groupRecordsByMonth(filterRecords(this._records, tabId))
    }, () => this.updateRecordsHeight())
  }
})
