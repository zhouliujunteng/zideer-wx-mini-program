const { loadCurrentGrowthCenter, redeemCurrentStudentCode } = require('../../services/identity')
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
  if (source.experience_product_access) labels.push('体验商品权益已开通')
  return labels
}

function createModel(inputValue = '', feedback = '', records = []) {
  return {
    title: '兑换码', heroTitle: '兑换你的专属权益',
    heroSubtitle: '输入兑换码，权益将进入当前学生账户。',
    heroIcon: '../../assets/redemption/redemption-hero.png', inputValue,
    inputPlaceholder: '输入兑换码', buttonLabel: '立即兑换', feedback,
    noticeTitle: '兑换说明', noticeIntro: '兑换码由知鹿私课服务端校验并发放权益。',
    noticeItems: ['每个兑换码只能使用一次。', '兑换成功后，课程积分、金币或体验权益会进入当前学生账户。', '请勿向他人泄露兑换码，失效或不适用时请联系服务支持。'],
    historyTitle: '兑换记录', historyCountLabel: records.length ? `${records.length} 条` : '暂无', historyActionLabel: '全部记录',
    history: records.map((item) => ({
      id: item.id, title: item.statusLabel || '兑换记录',
      description: benefitLabels(item.benefits).join(' · ') || '权益记录',
      maskedCode: item.code_masked || item.code || '兑换码已隐藏',
      time: formatDate(item.redeemed_at || item.created_at)
    }))
  }
}

Page({
  data: { model: createModel(), statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, currentStudentId: null, loading: true, redeeming: false, noticeSheetVisible: false, noticeSheetClosing: false, resultSheetVisible: false, resultSheetClosing: false, resultState: {} },

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
    this.setData({ loading: true })
    try {
      const center = await loadCurrentGrowthCenter()
      this.setData({ currentStudentId: center.student && center.student.id || null, model: createModel(this.data.model.inputValue, '', center.redemptionRecords || []) })
    } catch (error) {
      this.setData({ model: createModel('', error.message || '兑换记录暂时无法读取，请稍后重试。') })
      wx.showToast({ title: error.message || '兑换记录加载失败', icon: 'none' })
    } finally { this.setData({ loading: false }) }
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
    this.setData({ model: createModel(value, '', this.data.model.history || []) })
  },
  async handleRedeem() {
    if (this.data.redeeming) return
    const code = String(this.data.model.inputValue || '').trim()
    const studentId = Number(this.data.currentStudentId)
    if (!code) return wx.showToast({ title: '请先输入兑换码', icon: 'none' })
    if (!Number.isSafeInteger(studentId) || studentId <= 0) return wx.showToast({ title: '当前学生资料尚未准备好，请稍后重试。', icon: 'none' })
    this.setData({ redeeming: true })
    try {
      const result = await redeemCurrentStudentCode(code, studentId)
      const labels = benefitLabels(result.benefits)
      this.setData({ resultSheetVisible: true, resultSheetClosing: false, resultState: { icon: '✓', title: '兑换成功', subtitle: labels.join(' · ') || '权益已进入当前学生账户' }, model: createModel('', '', this.data.model.history || []) })
      await this.loadPage()
    } catch (error) {
      this.setData({ resultSheetVisible: true, resultSheetClosing: false, resultState: { icon: '!', title: '兑换未完成', subtitle: error.message || '请检查兑换码后重试。' }, model: createModel(code, error.message || '', this.data.model.history || []) })
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
      this.setData({ model: createModel(value.toUpperCase().replace(/\s+/g, ''), '', this.data.model.history || []) })
    }, fail: (error) => { if (!/cancel|取消/i.test(String(error && error.errMsg || ''))) wx.showToast({ title: '暂时无法读取二维码', icon: 'none' }) } })
  },
  stopTap() {}
})
