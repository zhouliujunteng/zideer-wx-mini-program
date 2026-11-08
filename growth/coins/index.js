const { loadCurrentGrowthCenter } = require('../../services/identity')
const {
  loadCoinExchange, startCoinExchange, resumeCoinExchange, syncCoinExchange, cancelCoinExchange, confirmTransfer
} = require('../../services/coin-exchange')
const { attachUiAssets } = require('../../services/ui-assets')
const { rpxToPx } = require('../../utils/screen')

// 设计师金币详情页视图模型：余额 + 兑换现金 + 按月分组流水（获得/使用页签）+ 金币服务入口
const RECORD_TABS = [
  { id: 'earned', label: '获得记录' },
  { id: 'spent', label: '使用记录' }
]

// 金币的用途：兑换现金转到本人微信零钱（2026-09-26 用户规则 100 金币 = 1 元）。
// 实际比例、上下限以服务端（运营活动 coin_cash_exchange）为准，读到之前按默认值显示说明文字。
const DEFAULT_COINS_PER_YUAN = 100
// 运营账户资金不足时服务端会暂停兑换一会儿（充值后自动恢复），给学生的说法
const PAUSED_MODAL = {
  title: '兑换维护中',
  content: '兑换现金暂时维护中，你的金币都在，稍后再来兑换吧。',
  showCancel: false,
  confirmText: '知道了',
  confirmColor: '#FD7C02'
}

const SERVICE_ENTRIES = [
  { id: 'tasks', label: '金币任务', hint: '每日签到与学习奖励', url: '/growth/coin-tasks/index' },
  { id: 'withdrawal', label: '兑换记录', hint: '金币兑换现金的申请与到账进度', url: '/growth/coin-withdrawal/index' }
]

const USAGE_RULES_ITEMS = [
  '每 100 金币可兑换 1 元现金，按整元兑换，兑换后直接转到你本人的微信零钱。',
  '兑换后会打开微信收款页，点「确认收款」钱才会到账；24 小时内没确认，金币会自动退回。',
  '兑换时先冻结对应金币，到账后才正式扣减；没到账或取消的兑换，金币会退回。',
  '单笔最多 200 元，每天最多兑换 3 次。',
  '金币只归属于本人的学生档案，家长切换孩子后不能代领或代为兑换。',
  '签到、学习任务和知识点掌握奖励按规则发放，同一件事不会重复奖励。',
  '知识点掌握奖励要在老师核验通过后才会发放。',
  '金币和课程积分是两套账户，不能互相转换。'
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

function yuanLabel(fen) {
  return (Math.max(0, Number(fen) || 0) / 100).toFixed(2)
}

function recordTabsFor(tabId) {
  return RECORD_TABS.map(tab => ({ ...tab, isSelected: tab.id === tabId }))
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
      statusLabel: coins > 0 ? '已入账' : '已使用'
    })
  })
  return groups
}

// 兑换卡：可兑换整元数、比例说明、在途的一笔（待确认收款 / 到账中）
function buildExchangeCard(available, exchange) {
  const rate = exchange && exchange.coinsPerYuan > 0 ? exchange.coinsPerYuan : DEFAULT_COINS_PER_YUAN
  const pending = exchange && exchange.pending
  return {
    yuan: String(Math.floor(Math.max(0, Number(available) || 0) / rate)),
    rateLabel: `${rate} 金币 = 1 元，直接转到微信零钱`,
    pending: pending ? {
      requestNo: pending.requestNo,
      waiting: pending.status === 'wait_user_confirm',
      amount: yuanLabel(pending.amountFen)
    } : null
  }
}

Page({
  data: {
    // 第一次读到账户前，余额和记录位显示骨架；读到过一次后回到页面保留旧数据，后台静默刷新。
    loaded: false,
    failed: false,
    model: null,
    recordTabs: recordTabsFor('earned'),
    serviceEntries: SERVICE_ENTRIES,
    activeTab: 'earned',
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    recordsHeight: 360,
    usageRulesItems: USAGE_RULES_ITEMS,
    usageRulesSheetVisible: false,
    usageRulesSheetClosing: false,
    // 兑换规则第一次读到（或读取失败）之前，比例说明位显示骨架
    exchangeLoaded: false,
    exchangeCard: buildExchangeCard(0, null),
    exchanging: false,
    exchangeSheetVisible: false,
    exchangeSheetClosing: false,
    exchangeSheet: null
  },

  onLoad() {
    attachUiAssets(this)
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

  onShow() {
    this.loadPage()
    this.loadExchange()
  },

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
      const growth = await loadCurrentGrowthCenter()
      this.coinAccount = growth.coinAccount || {}
      this.coinLedger = growth.coinLedger || []
      this.applyModel(this.data.activeTab)
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '金币账户加载失败', icon: 'none' })
    }
  },

  // 兑换规则与在途的一笔。读取失败不打扰：点「兑换现金」时再读一次并提示原因。
  async loadExchange() {
    try {
      this.exchange = await loadCoinExchange()
      this.exchangeError = null
    } catch (error) {
      this.exchangeError = error
    }
    this.setData({ exchangeLoaded: true })
    this.applyExchangeCard()
    return this.exchange
  },

  applyModel(tabId) {
    const account = this.coinAccount || {}
    this.setData({
      loaded: true,
      activeTab: tabId,
      recordTabs: recordTabsFor(tabId),
      model: {
        balance: {
          available: account.available != null ? String(account.available) : '—',
          frozen: account.frozen != null ? String(account.frozen) : '—'
        },
        activeRecordGroups: buildRecordGroups(this.coinLedger, tabId)
      }
    })
    this.applyExchangeCard()
  },

  applyExchangeCard() {
    const account = this.coinAccount || {}
    this.setData({ exchangeCard: buildExchangeCard(account.available, this.exchange) })
  },

  reloadAll() {
    return Promise.all([this.loadPage(), this.loadExchange()])
  },

  async handleExchange() {
    if (this.data.exchanging) return
    const pending = this.data.exchangeCard.pending
    if (pending) return pending.waiting ? this.resumeExchange(pending.requestNo) : this.refreshPending(pending.requestNo)
    const exchange = this.exchange || await this.loadExchange()
    if (!exchange) {
      wx.showToast({ title: (this.exchangeError && this.exchangeError.message) || '兑换服务暂时不可用，请稍后再试。', icon: 'none' })
      return
    }
    if (exchange.enabled && exchange.paused) {
      wx.showModal(PAUSED_MODAL)
      return
    }
    if (!exchange.enabled) {
      wx.showModal({
        title: '兑换到微信零钱',
        content: `每 ${exchange.coinsPerYuan} 金币可兑换 1 元，兑换后直接转到你本人的微信零钱。兑换功能即将开放，开放后在这里就能兑换。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#FD7C02'
      })
      return
    }
    const rate = exchange.coinsPerYuan
    const available = this.coinAccount && this.coinAccount.available != null ? Number(this.coinAccount.available) : exchange.available
    const maxYuan = Math.min(Math.floor(available / rate), exchange.maxYuan)
    if (maxYuan < exchange.minYuan) {
      wx.showModal({
        title: '金币还不够',
        content: `满 ${rate * exchange.minYuan} 金币就能兑换 ${exchange.minYuan} 元，继续学习攒金币吧。`,
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#FD7C02'
      })
      return
    }
    const remaining = Math.max(0, exchange.dailyLimit - exchange.todayCount)
    if (!remaining) {
      wx.showToast({ title: '今天的兑换次数用完了，明天再来吧。', icon: 'none' })
      return
    }
    this.setData({
      exchangeSheetVisible: true,
      exchangeSheetClosing: false,
      exchangeSheet: this.sheetModel(maxYuan, { rate, minYuan: exchange.minYuan, maxYuan, remaining })
    })
  },

  sheetModel(yuan, limits) {
    const value = Math.min(Math.max(yuan, limits.minYuan), limits.maxYuan)
    return { ...limits, yuan: value, coins: value * limits.rate, canDecrease: value > limits.minYuan, canIncrease: value < limits.maxYuan }
  },

  changeExchangeYuan(event) {
    const sheet = this.data.exchangeSheet
    if (!sheet || this.data.exchanging) return
    const step = Number(event.currentTarget.dataset.step) || 0
    this.setData({ exchangeSheet: this.sheetModel(sheet.yuan + step, sheet) })
  },

  exchangeAll() {
    const sheet = this.data.exchangeSheet
    if (!sheet || this.data.exchanging) return
    this.setData({ exchangeSheet: this.sheetModel(sheet.maxYuan, sheet) })
  },

  closeExchangeSheet() {
    if (!this.data.exchangeSheetVisible || this.data.exchangeSheetClosing || this.data.exchanging) return
    this.setData({ exchangeSheetClosing: true })
    setTimeout(() => {
      this.setData({ exchangeSheetVisible: false, exchangeSheetClosing: false })
    }, 280)
  },

  async submitExchange() {
    const sheet = this.data.exchangeSheet
    if (!sheet || this.data.exchanging) return
    this.setData({ exchanging: true })
    try {
      const result = await startCoinExchange(sheet.coins)
      this.setData({ exchanging: false })
      this.closeExchangeSheet()
      await this.finishTransfer(result)
    } catch (error) {
      if (error.code === 'EXCHANGE_PAUSED') {
        this.setData({ exchanging: false })
        this.closeExchangeSheet()
        wx.showModal(PAUSED_MODAL)
      } else {
        wx.showToast({ title: error.message || '兑换没有成功，请稍后再试。', icon: 'none' })
      }
    } finally {
      this.setData({ exchanging: false })
      this.reloadAll()
    }
  },

  async resumeExchange(requestNo) {
    this.setData({ exchanging: true })
    try {
      const result = await resumeCoinExchange(requestNo)
      this.setData({ exchanging: false })
      await this.finishTransfer(result)
    } catch (error) {
      wx.showToast({ title: error.message || '没能继续这笔兑换，请稍后再试。', icon: 'none' })
    } finally {
      this.setData({ exchanging: false })
      this.reloadAll()
    }
  },

  async refreshPending(requestNo) {
    this.setData({ exchanging: true })
    try {
      const { exchange } = await syncCoinExchange(requestNo)
      if (exchange.status === 'paid') wx.showToast({ title: '已到账', icon: 'success' })
      else if (exchange.status === 'failed' || exchange.status === 'cancelled') wx.showToast({ title: '这笔没有到账，金币已退回', icon: 'none' })
      else wx.showToast({ title: '微信还在处理，请稍后再看', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '刷新失败，请稍后再试。', icon: 'none' })
    } finally {
      this.setData({ exchanging: false })
      this.reloadAll()
    }
  },

  // 拉起微信确认收款页，按结果推进：确认 → 查到账；放弃 → 撤销转账，金币退回。
  async finishTransfer(result) {
    const exchange = result.exchange
    const amount = yuanLabel(exchange.amountFen)
    if (!result.confirm) {
      if (exchange.status === 'paid') {
        wx.showToast({ title: `¥${amount} 已到账`, icon: 'success' })
        return
      }
      wx.showModal({
        title: '兑换处理中',
        content: '微信正在处理这笔兑换，稍后回到这里看看。需要你确认收款时，按钮会变成「去确认收款」。',
        showCancel: false,
        confirmText: '知道了',
        confirmColor: '#FD7C02'
      })
      return
    }
    let outcome
    try {
      outcome = await confirmTransfer(result.confirm)
    } catch (error) {
      if (error.code === 'UNSUPPORTED') await cancelCoinExchange(exchange.requestNo).catch(() => null)
      wx.showModal({ title: '没能打开收款页', content: error.message, showCancel: false, confirmText: '知道了', confirmColor: '#FD7C02' })
      return
    }
    if (outcome === 'cancelled') {
      await cancelCoinExchange(exchange.requestNo).catch(() => null)
      wx.showToast({ title: '已取消兑换，金币会退回', icon: 'none' })
      return
    }
    const synced = await syncCoinExchange(exchange.requestNo).catch(() => null)
    if (synced && synced.exchange.status === 'paid') {
      wx.showModal({ title: '兑换成功', content: `¥${amount} 已转到你的微信零钱。`, showCancel: false, confirmText: '好的', confirmColor: '#FD7C02' })
    } else {
      wx.showToast({ title: '已确认收款，稍后到账', icon: 'success' })
    }
  },

  openService(event) {
    const url = event.currentTarget.dataset.url
    if (url) wx.navigateTo({ url })
  },

  handleBack() {
    if (this.data.exchangeSheetVisible) {
      this.closeExchangeSheet()
      return
    }
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
