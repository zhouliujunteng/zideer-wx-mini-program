const { loadCurrentGrowthCenter } = require('../../services/identity')

// 设计师金币详情页视图模型：余额 + 按月分组流水（获得/使用页签）+ 金币服务入口
const RECORD_TABS = [
  { id: 'earned', label: '获得记录' },
  { id: 'spent', label: '使用记录' }
]

const SERVICE_ENTRIES = [
  { id: 'tasks', label: '金币任务', hint: '每日签到与学习奖励', url: '/growth/coin-tasks/index' },
  { id: 'withdrawal', label: '提现记录', hint: '金币提现申请与进度', url: '/growth/coin-withdrawal/index' },
  { id: 'redemption', label: '兑换码', hint: '兑换课程积分与权益', url: '/pages/redemption/index' }
]

const USAGE_RULES_ITEMS = [
  '金币只归属于当前业务用户的默认学生档案，家长切换孩子后不能代领或提现。',
  '签到、学习任务和知识点掌握奖励必须按有效规则发放，同一事件不能重复奖励。',
  '知识点掌握奖励必须在老师核验通过、形成最终掌握证据后才会发放。',
  '金币提现会先冻结申请数量，经过风控和本人微信收款确认后才完成扣减；失败会释放金币。',
  '金币与课程积分完全分账，兑换码权益和实际入账以服务端事务结果为准。'
]

function monthLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月`
}

function timeLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildRecordGroups(ledger, tabId) {
  const filtered = (ledger || []).filter(item => (tabId === 'earned' ? Number(item.coins) > 0 : Number(item.coins) < 0))
  const groups = []
  const indexByMonth = {}
  filtered.forEach((item) => {
    const key = monthLabel(item.occurred_at) || '更早'
    if (!(key in indexByMonth)) {
      indexByMonth[key] = { monthKey: key, monthLabel: key, records: [] }
      groups.push(indexByMonth[key])
    }
    const coins = Number(item.coins) || 0
    indexByMonth[key].records.push({
      id: item.id,
      title: item.businessLabel,
      amount: `${coins > 0 ? '+' : ''}${coins}`,
      tone: coins > 0 ? 'positive' : 'negative',
      detail: item.balance_after != null ? `变动后可用 ${item.balance_after}` : '',
      detailTone: 'muted',
      time: timeLabel(item.occurred_at),
      statusLabel: '已入账'
    })
  })
  return groups
}

Page({
  data: {
    loading: true,
    failed: false,
    model: null,
    serviceEntries: SERVICE_ENTRIES,
    activeTab: 'earned',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    recordsHeight: 360,
    usageRulesItems: USAGE_RULES_ITEMS,
    usageRulesSheetVisible: false,
    usageRulesSheetClosing: false
  },

  onLoad() {
    // 自定义顶栏需要的安全区尺寸（环境不提供时保持默认）
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    const windowWidth = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32, width: 87, left: windowWidth - 92 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({
      statusBarHeight,
      navigationBarHeight,
      contentTop: statusBarHeight + navigationBarHeight + 18
    }, () => this.updateRecordsHeight(windowInfo.windowHeight))
  },

  onResize(res) {
    const windowHeight = res && res.size && res.size.windowHeight ? res.size.windowHeight : null
    if (windowHeight) this.updateRecordsHeight(windowHeight)
  },

  onShow() { this.loadPage() },

  updateRecordsHeight(windowHeight) {
    if (!windowHeight) return
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    const windowWidth = windowInfo.windowWidth || 375
    const horizontalPadding = windowWidth <= 350 ? 24 : 32
    const bottomGap = Math.round(windowWidth * horizontalPadding / 750)
    wx.createSelectorQuery().select('.records-card').boundingClientRect((rect) => {
      if (!rect) return
      const recordsHeight = Math.max(280, Math.floor(windowHeight - rect.top - bottomGap))
      if (recordsHeight !== this.data.recordsHeight) this.setData({ recordsHeight })
    }).exec()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const growth = await loadCurrentGrowthCenter()
      this.coinAccount = growth.coinAccount || {}
      this.coinLedger = growth.coinLedger || []
      this.applyModel(this.data.activeTab)
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '金币账户加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyModel(tabId) {
    const account = this.coinAccount || {}
    const tabs = RECORD_TABS.map(tab => ({ ...tab, isSelected: tab.id === tabId }))
    this.setData({
      activeTab: tabId,
      model: {
        title: '我的金币',
        balanceLabel: '当前可用金币',
        balanceIcon: '/assets/commerce/coins-detail.png',
        usageRulesLabel: '使用规则',
        recordsTitle: '金币记录',
        balance: { available: account.available != null ? String(account.available) : '—', frozen: account.frozen != null ? String(account.frozen) : '—' },
        recordTabs: tabs,
        activeRecordGroups: buildRecordGroups(this.coinLedger, tabId)
      }
    })
  },

  openService(event) {
    const url = event.currentTarget.dataset.url
    if (url) wx.navigateTo({ url })
  },

  handleBack() {
    if (this.data.usageRulesSheetVisible) {
      this.closeUsageRules()
      return
    }
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.switchTab({ url: '/pages/me/index' })
  },

  handleUsageRules() {
    this.setData({ usageRulesSheetVisible: true, usageRulesSheetClosing: false })
  },

  closeUsageRules() {
    if (!this.data.usageRulesSheetVisible || this.data.usageRulesSheetClosing) return
    this.setData({ usageRulesSheetClosing: true })
    setTimeout(() => {
      this.setData({ usageRulesSheetVisible: false, usageRulesSheetClosing: false })
    }, 280)
  },

  stopTap() {},

  handleRecordTab(e) {
    const tabId = e.currentTarget.dataset.id
    if (tabId && tabId !== this.data.activeTab) this.applyModel(tabId)
  }
})
