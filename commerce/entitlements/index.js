const { loadCurrentCreditAccount } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx } = require('../../utils/screen')

// 设计师 M34 课程积分页视图模型：余额 + 批次 + 按月分组流水（获得/使用页签）
const RECORD_TABS = [
  { id: 'earned', label: '获得记录' },
  { id: 'spent', label: '使用记录' }
]

const USAGE_RULES = {
  title: '课程积分使用规则',
  intro: '课程积分用于生成定制课程，每一次扣除、退回、补扣都会记在积分记录里。',
  items: [
    '定制课程每节单独扣积分，按这节课实际生成的内容结算；老师和你确认课程方案时会先告诉你预估。',
    '积分不够时课程照常生成：余额扣到 0，不够的部分记为待补扣，之后获得积分时会先自动补扣。',
    '生成失败的课程不扣积分；先冻结再结算的课程，多余的冻结积分会自动退回。',
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

function dateLabel(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

// 后端每发一次积分就是一个批次（各自的有效期、扣费先扣早到期的、退回回原批次），页面按来源合并成一行：
// 邀请了 10 个好友只显示一行「共 10 笔」，逐笔明细看下面的积分记录。用完、过期的批次不计入，整个来源没剩就不显示。
function buildBatchGroups(batches, now = Date.now()) {
  const groups = []
  const indexByLabel = {}
  const list = batches || []
  list.forEach((item) => {
    const cents = Math.round(Number(item.remaining_credits) * 100)
    if (!(cents > 0) || String(item.status || 'active') !== 'active') return
    const expiresAt = item.expires_at ? new Date(item.expires_at).getTime() : null
    if (expiresAt !== null && !(expiresAt > now)) return
    const label = item.sourceLabel || '其他来源'
    if (!(label in indexByLabel)) {
      indexByLabel[label] = { id: label, sourceLabel: label, count: 0, cents: 0, earliestExpiry: null, latestActive: null }
      groups.push(indexByLabel[label])
    }
    const group = indexByLabel[label]
    const activeAt = new Date(item.active_at || item.created_at).getTime()
    group.count += 1
    group.cents += cents
    if (expiresAt !== null && (group.earliestExpiry === null || expiresAt < group.earliestExpiry)) group.earliestExpiry = expiresAt
    if (!Number.isNaN(activeAt) && (group.latestActive === null || activeAt > group.latestActive)) group.latestActive = activeAt
  })
  // 有期限的排前面、越早到期越靠前（扣费也先扣它们），其余按最近获得排
  groups.sort((a, b) => (a.earliestExpiry === null ? Infinity : a.earliestExpiry) - (b.earliestExpiry === null ? Infinity : b.earliestExpiry)
    || (b.latestActive || 0) - (a.latestActive || 0))
  return groups.map((group) => {
    const count = group.count > 1 ? `共 ${group.count} 笔` : ''
    const when = group.earliestExpiry !== null
      ? `${group.count > 1 ? '最早 ' : ''}${dateLabel(group.earliestExpiry)} 到期`
      : (group.latestActive !== null ? `${group.count > 1 ? '最近获得于' : '获得于'} ${dateLabel(group.latestActive)}` : '')
    return {
      id: group.id,
      sourceLabel: group.sourceLabel,
      metaLabel: [count, when].filter(Boolean).join(' · '),
      remainingCreditsDisplay: String(Math.round(group.cents / 100))
    }
  })
}

function recordTabsFor(tabId) {
  return RECORD_TABS.map(tab => ({ ...tab, isSelected: tab.id === tabId }))
}

function buildRecordGroups(ledger, tabId) {
  // 定制课程扣费即使当时余额为 0（整节记欠款）也算一条使用记录
  const filtered = (ledger || []).filter(item => (tabId === 'earned'
    ? Number(item.credits) > 0
    : Number(item.credits) < 0 || item.business_type === 'agent_course'))
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
      detail: item.counterpartyLabel || '',
      detailTone: 'muted',
      time: timeLabel(item.occurred_at),
      statusLabel: '已入账'
    })
  })
  return groups
}

Page({
  data: {
    // 第一次读到账户前，余额和记录位显示骨架；读到过一次后回到页面保留旧数据，后台静默刷新。
    loaded: false,
    failed: false,
    model: null,
    recordTabs: recordTabsFor('earned'),
    activeTab: 'earned',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    recordsHeight: 360,
    forStudent: false,
    usageRulesItems: USAGE_RULES.items,
    usageRulesSheetVisible: false,
    usageRulesSheetClosing: false
  },

  onLoad(options) {
    attachUiAssets(this)
    // 家长从看板进入时带孩子的档案 id；本人查看不带参数
    this.studentId = options && options.studentId ? String(options.studentId) : ''
    // 家长查看时标题带孩子名字，读到前标题位显示骨架
    this.setData({ forStudent: !!this.studentId })
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
    this.windowHeight = windowInfo.windowHeight
  },

  onResize(res) {
    const windowHeight = res && res.size && res.size.windowHeight ? res.size.windowHeight : null
    if (windowHeight) {
      this.windowHeight = windowHeight
      this.updateRecordsHeight(windowHeight)
    }
  },

  onShow() { this.loadPage() },

  updateRecordsHeight(windowHeight) {
    if (!windowHeight) return
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : (wx.getSystemInfoSync ? wx.getSystemInfoSync() : {})
    const windowWidth = windowInfo.windowWidth || 375
    const horizontalPadding = windowWidth <= 350 ? 24 : 32
    const bottomGap = Math.round(rpxToPx(horizontalPadding, windowWidth))
    wx.createSelectorQuery().select('.records-card').boundingClientRect((rect) => {
      if (!rect) return
      const recordsHeight = Math.max(280, Math.floor(windowHeight - rect.top - bottomGap))
      if (recordsHeight !== this.data.recordsHeight) this.setData({ recordsHeight })
    }).exec()
  },

  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    try {
      const data = await loadCurrentCreditAccount(this.studentId)
      this.ledger = data.ledger || []
      this.account = data.account || {}
      this.debt = data.debt || '0'
      this.batches = data.batches || []
      this.viewer = data.viewer || { isSelf: true }
      this.student = data.student || null
      this.family = data.family || null
      const firstLoad = !this.data.loaded
      this.applyModel(this.data.activeTab)
      // 批次区在首次读到后才出现，记录卡位置下移，重新量一次高度
      if (firstLoad) this.updateRecordsHeight(this.windowHeight)
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '积分账户加载失败', icon: 'none' })
    }
  },

  applyModel(tabId) {
    const account = this.account || {}
    this.setData({
      loaded: true,
      activeTab: tabId,
      recordTabs: recordTabsFor(tabId),
      model: {
        title: this.viewer && this.viewer.isSelf === false && this.student && this.student.name ? `${this.student.name}的课程积分` : '课程积分',
        // 2026-11-11：孩子由家长的会员出积分时显示家庭账户（家长名下，全家共用）
        familyNote: this.family ? `家庭账户 · ${this.family.name}名下，全家共用` : '',
        balance: {
          available: account.available != null ? String(account.available) : '—',
          frozen: account.frozen != null ? String(account.frozen) : '—',
          // 定制课程余额不够时记下、还没补扣的积分；没有欠款为空串（不显示）
          debt: this.debt && this.debt !== '0' ? String(this.debt) : ''
        },
        batches: buildBatchGroups(this.batches),
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
    if (!tabId || tabId === this.data.activeTab) return
    // 账户还没读到时只切页签，不拿空账户拼出「—」余额
    if (!this.data.loaded) this.setData({ activeTab: tabId, recordTabs: recordTabsFor(tabId) })
    else this.applyModel(tabId)
  }
})
