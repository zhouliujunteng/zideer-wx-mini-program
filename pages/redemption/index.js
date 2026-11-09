const { loadCurrentGrowthCenter, redeemCurrentStudentCode, unlockDevelopmentReset } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')

function formatDate(value) {
  if (!value) return '待处理'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '待处理'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function benefitLabels(benefits) {
  const source = benefits && typeof benefits === 'object' ? benefits : {}
  const labels = []
  const credits = Number(source.course_credit)
  const coins = Number(source.coin)
  if (Number.isFinite(credits) && credits > 0) labels.push(`课程积分 +${credits}`)
  if (Number.isFinite(coins) && coins > 0) labels.push(`金币 +${coins}`)
  // 学习连胜道具卡（激活码可领，2026-09-25）
  const freezeCards = Number(source.streak_freeze_card)
  const reviveCards = Number(source.streak_revive_card)
  if (Number.isFinite(freezeCards) && freezeCards > 0) labels.push(`冻结卡 +${freezeCards}`)
  if (Number.isFinite(reviveCards) && reviveCards > 0) labels.push(`复活卡 +${reviveCards}`)
  // 成就卡通用抽卡次数（2026-10-13，课程服务按兑换记录发放，任意卡可用）
  const cardDraws = Number(source.achievement_card_draw)
  if (Number.isFinite(cardDraws) && cardDraws > 0) labels.push(`成就卡抽卡次数 +${cardDraws}`)
  if (source.experience_product_access) labels.push('体验商品权益已开通')
  return labels
}

// 兑换记录默认只露前几条，多了点「全部记录」展开（2026-10-06：原来的「全部记录」点了没反应）
const HISTORY_PREVIEW = 3

function statusTone(status) {
  if (status === 'succeeded' || status === 'success' || status === 'redeemed' || status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled' || status === 'closed') return 'failed'
  return 'pending'
}

function historyRow(item) {
  return {
    id: item.id,
    title: benefitLabels(item.benefits).join(' · ') || '兑换权益',
    code: `兑换码 ${item.code_masked || item.code || '已隐藏'}`,
    statusLabel: item.statusLabel || '已兑换',
    statusTone: statusTone(item.status),
    time: formatDate(item.redeemed_at || item.created_at)
  }
}

// records 是后端原始记录（statusLabel / benefits / code_masked / redeemed_at）。
// 页面另存一份原始记录（this.records），输入兑换码时不要把已经转成显示格式的 history 再交回来——
// 以前这么做，输入一个字下面每条记录都变成「兑换记录 / 权益记录 / 兑换码已隐藏」。
function createModel(inputValue = '', feedback = '', records = [], expanded = false) {
  const rows = records.map(historyRow)
  const collapsible = rows.length > HISTORY_PREVIEW
  return {
    title: '兑换码', heroTitle: '兑换你的专属权益',
    heroSubtitle: '输入兑换码，权益将进入当前学生账户。',
    heroIcon: '../../assets/redemption/redemption-hero.png', inputValue,
    inputPlaceholder: '输入兑换码', buttonLabel: '立即兑换', feedback,
    noticeTitle: '兑换说明', noticeIntro: '兑换码由知鹿学习服务端校验并发放权益。',
    noticeItems: ['每个兑换码只能使用一次。', '兑换成功后，课程积分、金币、体验权益或学习连胜道具卡（冻结卡、复活卡）会进入当前学生账户。', '请勿向他人泄露兑换码，失效或不适用时请联系服务支持。'],
    historyTitle: '兑换记录', historyCountLabel: rows.length ? `共 ${rows.length} 条` : '',
    historyActionLabel: collapsible ? (expanded ? '收起' : '全部记录') : '',
    historyExpanded: expanded,
    history: collapsible && !expanded ? rows.slice(0, HISTORY_PREVIEW) : rows
  }
}

Page({
  // 兑换记录第一次读到前只显示骨架，不先闪「暂无兑换记录」；读到过一次后刷新时保留旧记录。
  data: { model: createModel(), statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, currentStudentId: null, loading: true, loaded: false, loadFailed: false, redeeming: false, noticeSheetVisible: false, noticeSheetClosing: false, resultSheetVisible: false, resultSheetClosing: false, resultState: {} },

  onLoad() {
    attachUiAssets(this)
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const width = windowInfo.windowWidth || 375
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32, width: 87, left: width - 92 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18 })
    this.loadPage()
  },

  async loadPage() {
    this.setData({ loading: true, loadFailed: false })
    try {
      const center = await loadCurrentGrowthCenter()
      this.records = center.redemptionRecords || []
      this.setData({ loaded: true, currentStudentId: center.student && center.student.id || null, model: this.buildModel(this.data.model.inputValue) })
    } catch (error) {
      // 首次失败在记录区显示重试；已有记录时只提示，保留旧记录和已输入的兑换码。
      if (!this.data.loaded) this.setData({ loadFailed: true })
      wx.showToast({ title: error.message || '兑换记录加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
  },

  buildModel(inputValue = '', feedback = '', expanded = this.data.model.historyExpanded) {
    return createModel(inputValue, feedback, this.records || [], expanded)
  },
  toggleHistory() {
    if (!this.data.model.historyActionLabel) return
    this.setData({ model: this.buildModel(this.data.model.inputValue, this.data.model.feedback, !this.data.model.historyExpanded) })
  },

  onPullDownRefresh() { this.loadPage().finally(() => wx.stopPullDownRefresh()) },
  handleBack() {
    if (this.data.resultSheetVisible) return this.closeResultSheet()
    if (this.data.noticeSheetVisible) return this.closeNotice()
    const pages = getCurrentPages()
    if (pages.length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  handleInput(event) {
    const value = String(event.detail.value || '').toUpperCase().replace(/\s+/g, '')
    this.setData({ model: this.buildModel(value) })
  },
  async handleRedeem() {
    if (this.data.redeeming) return
    const code = String(this.data.model.inputValue || '').trim()
    if (!code) return wx.showToast({ title: '请先输入兑换码', icon: 'none' })
    this.setData({ redeeming: true })
    try {
      // 「重置测试账号」的开启码也在这里输入（2026-09-28 用户规则）：先问后端是不是开启码，是就不走兑换。
      // 放在学生资料检查之前：家长、还没建档的账号也能开启。
      if (await unlockDevelopmentReset(code)) {
        this.setData({ resultSheetVisible: true, resultSheetClosing: false, resultState: { icon: '✓', title: '已开启重置测试账号', subtitle: '页面右下角会出现「重置测试账号」按钮，这台手机上登录的账号都能用。' }, model: this.buildModel('') })
        return
      }
      const studentId = Number(this.data.currentStudentId)
      if (!Number.isSafeInteger(studentId) || studentId <= 0) return wx.showToast({ title: '当前学生资料尚未准备好，请稍后重试。', icon: 'none' })
      const result = await redeemCurrentStudentCode(code, studentId)
      const labels = benefitLabels(result.benefits)
      this.setData({ resultSheetVisible: true, resultSheetClosing: false, resultState: { icon: '✓', title: '兑换成功', subtitle: labels.join(' · ') || '权益已进入当前学生账户' }, model: this.buildModel('') })
      await this.loadPage()
    } catch (error) {
      this.setData({ resultSheetVisible: true, resultSheetClosing: false, resultState: { icon: '!', title: '兑换未完成', subtitle: error.message || '请检查兑换码后重试。' }, model: this.buildModel(code, error.message || '') })
    } finally { this.setData({ redeeming: false }) }
  },
  openNotice() { this.setData({ noticeSheetVisible: true, noticeSheetClosing: false }) },
  closeNotice() {
    if (!this.data.noticeSheetVisible || this.data.noticeSheetClosing) return
    this.setData({ noticeSheetClosing: true }); setTimeout(() => this.setData({ noticeSheetVisible: false, noticeSheetClosing: false }), 280)
  },
  closeResultSheet() {
    if (!this.data.resultSheetVisible || this.data.resultSheetClosing) return
    this.setData({ resultSheetClosing: true }); setTimeout(() => this.setData({ resultSheetVisible: false, resultSheetClosing: false, resultState: {} }), 280)
  },
  handleScanCode() {
    if (!wx.scanCode) return wx.showToast({ title: '当前环境暂不支持扫码', icon: 'none' })
    wx.scanCode({ onlyFromCamera: false, scanType: ['qrCode', 'barCode'], success: (result) => {
      const value = String(result && result.result || '').trim()
      if (!value) return wx.showToast({ title: '未读取到兑换码', icon: 'none' })
      this.setData({ model: this.buildModel(value.toUpperCase().replace(/\s+/g, '')) })
    }, fail: (error) => { if (!/cancel|取消/i.test(String(error && error.errMsg || ''))) wx.showToast({ title: '暂时无法读取二维码', icon: 'none' }) } })
  },
  stopTap() {}
})
