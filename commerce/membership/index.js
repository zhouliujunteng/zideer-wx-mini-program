const { loadCurrentMembership, createMembershipOrder, payWechatOrder, isWechatPaymentCancelled, loadMeDashboard } = require('../../services/identity')
const { membershipView, dateText, creditsText } = require('../../services/membership-view')
const WAITING_KEY = 'library_membership_confirming_order'
const labels = { active: '会员已开通', inactive: '尚未开通', expired: '会员已到期', pending: '订单待支付', refunded: '退款处理中或已退款', closed: '订单已关闭' }

// Visual layout follows the designer's E02 page; tiers, prices and actions come only from the server result.
function tierChoice(membership, selectedTierId) {
  const tiers = membership && Array.isArray(membership.tiers) ? membership.tiers : []
  const pendingTierId = membership && membership.status === 'pending' && membership.order ? String(membership.order.productVersionId || '') : ''
  const ids = tiers.map(tier => String(tier.productVersionId))
  const selected = ids.includes(String(selectedTierId)) ? String(selectedTierId) : ids.includes(pendingTierId) ? pendingTierId : ids[0] || ''
  return { selected, tiers }
}

function actionView(membership, member, confirming, selectedTierId) {
  const empty = { primaryLabel: '', primaryAction: '', showPlan: false, plans: [], selectedTierId: '' }
  if (!membership) return empty
  if (member.active) return { ...empty, primaryLabel: '进入会员课程库', primaryAction: 'openLibrary' }
  if (confirming) return { ...empty, primaryLabel: '正在确认支付结果' }
  const { selected, tiers } = tierChoice(membership, selectedTierId)
  const plans = tiers.map(tier => ({ id: String(tier.productVersionId), name: tier.name, price: tier.amount,
    note: Number(tier.creditAmount) > 0 ? `赠送 ${creditsText(tier.creditAmount)} 积分` : '永久会员', isSelected: String(tier.productVersionId) === selected }))
  const tier = tiers.find(item => String(item.productVersionId) === selected)
  if (!tier) return { ...empty, showPlan: false }
  const order = membership.order
  const resumable = membership.status === 'pending' && order && order.canPay === true && String(order.productVersionId) === selected
  return { primaryLabel: resumable ? `继续支付 ¥${order.amount}` : `开通${tier.name} ¥${tier.amount}`, primaryAction: 'purchase', showPlan: true, plans, selectedTierId: selected }
}

Page({
  data: {
    loading: true, paying: false, error: '', notice: '', membership: null, member: membershipView(null), statusLabel: '', expiresText: '', paidText: '', confirming: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, topbarSolid: false,
    profile: { name: '知鹿学员', initial: '鹿', avatarSrc: '' },
    primaryLabel: '', primaryAction: '', showPlan: false, plans: [], selectedTierId: '', planPressingId: '',
    agreementChecked: false, agreementSheetVisible: false, agreementSheetClosing: false
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const windowWidth = windowInfo.windowWidth || 375
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: statusBarHeight + 6, height: 32, width: 87, left: windowWidth - 92 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 4 })
  },
  onShow() {
    this._visible = true
    this.loadProfile()
    if (!this._paying) {
      this.setData({ membership: null, member: membershipView(null), loading: true, statusLabel: '', expiresText: '', paidText: '', confirming: false, ...actionView(null) })
      return this.refresh()
    }
  },
  onHide() { this._visible = false; this.stopPolling(); this._version = (this._version || 0) + 1 },
  onUnload() { this._disposed = true; this.onHide(); if (this._sheetTimer) clearTimeout(this._sheetTimer); if (this._planPressTimer) clearTimeout(this._planPressTimer) },
  // The page itself never scrolls (designer E02): the fixed scroll-view keeps bounce areas painted.
  handleScroll(e) {
    const topbarSolid = e.detail.scrollTop > 12
    if (topbarSolid !== this.data.topbarSolid) this.setData({ topbarSolid })
  },
  async loadProfile() {
    const version = this._profileVersion = (this._profileVersion || 0) + 1
    try {
      const { profile } = await loadMeDashboard()
      if (this._disposed || version !== this._profileVersion) return
      this.setData({ profile: { name: profile.displayName || '知鹿学员', initial: profile.initial || '鹿', avatarSrc: profile.avatarUrl || '' } })
    } catch (error) {
      // The hero keeps its neutral name; membership status is loaded separately.
    }
  },
  stopPolling() { if (this._timer) clearTimeout(this._timer); this._timer = null },
  applyMembership(membership) {
    const order = membership.order
    const confirming = membership.status === 'pending' && order && String(wx.getStorageSync(WAITING_KEY)) === String(order.orderId)
    if (membership.status !== 'pending' && order && String(wx.getStorageSync(WAITING_KEY)) === String(order.orderId)) wx.removeStorageSync(WAITING_KEY)
    const member = membershipView(membership)
    this.setData({ membership, member, confirming: !!confirming, statusLabel: confirming ? '正在确认支付结果' : labels[membership.status],
      expiresText: dateText(membership.expiresAt), paidText: dateText(order && order.paidAt), ...actionView(membership, member, !!confirming, this.data.selectedTierId) })
  },
  async refresh(poll = false) {
    if (this._paying || this._disposed) return
    this.stopPolling()
    if (poll !== true) this._attempts = 0
    const version = this._version = (this._version || 0) + 1
    this.setData({ loading: !this.data.membership, error: '' })
    try {
      const membership = await loadCurrentMembership()
      if (!this._visible || version !== this._version) return
      this.applyMembership(membership)
      if (this.data.confirming) {
        this._attempts = (this._attempts || 0) + 1
        if (this._attempts < 10) this._timer = setTimeout(() => this.refresh(true), 2000)
        else this.setData({ notice: '支付结果尚未确认。如已扣款，请勿重复支付，可稍后重新查询。' })
      } else this.setData({ notice: '' })
    } catch (error) {
      if (this._visible && version === this._version) this.setData({ error: error.message || '会员状态读取失败，请重新查询。' })
    } finally {
      if (this._visible && version === this._version) this.setData({ loading: false })
    }
  },
  selectTier(event) {
    const id = String(event.currentTarget.dataset.id || '')
    if (!id || this._paying || !this.data.membership) return
    if (this._planPressTimer) clearTimeout(this._planPressTimer)
    if (typeof wx.vibrateShort === 'function') {
      try { wx.vibrateShort({ type: 'light' }) } catch (error) { /* Desktop runtimes may lack haptics. */ }
    }
    this.setData({ selectedTierId: id, planPressingId: id, ...actionView(this.data.membership, this.data.member, this.data.confirming, id) })
    this._planPressTimer = setTimeout(() => {
      this._planPressTimer = null
      if (this.data.planPressingId === id) this.setData({ planPressingId: '' })
    }, 280)
  },
  async purchase() {
    if (this._paying || this.data.confirming || this.data.loading || this.data.error || !this.data.membership || this.data.membership.eligible || !this.data.selectedTierId) return
    this._paying = true
    this.stopPolling()
    this.setData({ paying: true, notice: '', error: '', agreementChecked: true })
    let order
    let cancelled = false
    try {
      const membership = await createMembershipOrder(this.data.selectedTierId)
      if (!this._visible || this._disposed) return
      this.applyMembership(membership)
      if (membership.eligible) return
      order = membership.order
      if (!order || order.canPay !== true) throw new Error('当前订单不能继续付款，请重新查询会员状态。')
      // Persist before opening WeChat so an interrupted app queries the same order first.
      wx.setStorageSync(WAITING_KEY, String(order.orderId))
      await payWechatOrder(order)
    } catch (error) {
      cancelled = isWechatPaymentCancelled(error) || error.paymentNotStarted === true
      if (cancelled && order) wx.removeStorageSync(WAITING_KEY)
      if (!this._disposed) this.setData({ notice: isWechatPaymentCancelled(error) ? '已取消支付，尚未开通会员。' : error.message || '支付结果未确认，请先重新查询。' })
    } finally {
      this._paying = false
      if (!this._disposed) this.setData({ paying: false })
      if (this._visible && order && !cancelled) await this.refresh()
    }
  },
  handlePrimaryAction() {
    if (this.data.primaryAction === 'openLibrary') return this.openLibrary()
    if (this.data.primaryAction === 'purchase') return this.purchase()
  },
  handleBack() {
    if (this.data.agreementSheetVisible) return this.closeAgreement()
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  toggleAgreement() { this.setData({ agreementChecked: !this.data.agreementChecked }) },
  openAgreement() { this.setData({ agreementSheetVisible: true, agreementSheetClosing: false }) },
  closeAgreement() {
    if (!this.data.agreementSheetVisible || this.data.agreementSheetClosing) return
    this.setData({ agreementSheetClosing: true })
    this._sheetTimer = setTimeout(() => { this._sheetTimer = null; this.setData({ agreementSheetVisible: false, agreementSheetClosing: false }) }, 280)
  },
  stopTap() {},
  openProducts() { wx.navigateTo({ url: '/commerce/products/index' }) },
  openLibrary() { wx.navigateTo({ url: '/learning/library/index' }) },
  openOrders() { wx.navigateTo({ url: '/commerce/orders/index' }) },
  openOrder() {
    const order = this.data.membership && this.data.membership.order
    if (order && /^[1-9][0-9]*$/.test(String(order.orderId))) wx.navigateTo({ url: '/commerce/order-detail/index?orderId=' + order.orderId })
  },
  openService() { wx.navigateTo({ url: '/account/service-contact/index' }) }
})
