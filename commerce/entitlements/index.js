const { loadCurrentCreditAccount } = require('../../services/identity')

// 设计师 M34 课程积分页视图模型：余额 + 批次 + 按月分组流水（获得/使用页签）
const RECORD_TABS = [
  { id: 'earned', label: '获得记录' },
  { id: 'spent', label: '使用记录' }
]

const USAGE_RULES = {
  title: '课程积分使用规则',
  intro: '课程积分用于生成定制课程，系统会按实际消耗记录积分变化。',
  items: [
    '课程生成前会先冻结预计所需积分，冻结中不会重复扣除。',
    '课程生成完成后按实际消耗扣除，多余的冻结积分会自动释放。',
    '生成失败或结算后未使用的积分，会返还到当前积分账户。',
    '不同积分批次可能有不同有效期，系统会优先使用较早到期的积分。',
    '课程积分仅用于课程服务，不能直接兑换现金，也不能与金币混用。'
  ]
}

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
  const filtered = (ledger || []).filter(item => (tabId === 'earned' ? Number(item.credits) > 0 : Number(item.credits) < 0))
  const groups = []
  const indexByMonth = {}
  filtered.forEach((item) => {
    const key = monthLabel(item.occurred_at) || '更早'
    if (!(key in indexByMonth)) {
      indexByMonth[key] = { monthKey: key, monthLabel: key, records: [] }
      groups.push(indexByMonth[key])
    }
    const credits = Number(item.credits) || 0
    indexByMonth[key].records.push({
      id: item.id,
      title: item.businessLabel,
      amount: `${credits > 0 ? '+' : ''}${item.creditsDisplay != null ? item.creditsDisplay : credits}`,
      tone: credits > 0 ? 'positive' : 'negative',
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
    activeTab: 'earned',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    recordsHeight: 360,
    usageRulesItems: USAGE_RULES.items,
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
      const data = await loadCurrentCreditAccount()
      this.ledger = data.ledger || []
      this.account = data.account || {}
      this.batches = data.batches || []
      this.applyModel(this.data.activeTab)
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '积分账户加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyModel(tabId) {
    const account = this.account || {}
    const tabs = RECORD_TABS.map(tab => ({ ...tab, isSelected: tab.id === tabId }))
    this.setData({
      activeTab: tabId,
      model: {
        title: '课程积分',
        balanceLabel: '当前可用积分',
        balanceIcon: '/assets/commerce/course-points-star-generated.png',
        usageRulesLabel: '使用规则',
        recordsTitle: '积分记录',
        balance: { available: account.available != null ? String(account.available) : '—', frozen: account.frozen != null ? String(account.frozen) : '—' },
        batches: this.batches,
        recordTabs: tabs,
        activeRecordGroups: buildRecordGroups(this.ledger, tabId)
      }
    })
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
