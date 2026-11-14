const { loadCurrentMembership, createMembershipOrder, isWechatPaymentCancelled, loadMeDashboard, loadFamilyWechatQr } = require('../../services/identity')
const { membershipView, benefitCards, dateText, creditsText, priceText } = require('../../services/membership-view')
const { attachUiAssets } = require('../../services/ui-assets')
const { guardianPays, GUARDIAN_PAYS_MESSAGE } = require('../../services/guardian-pay')
const { checkPaymentPage, showPaymentClosed, isPaymentDisabled, leavePaymentPage, openPaymentPage } = require('../../services/payment-switch')
// 付款方式（2026-11-13）：默认虚拟支付、iOS 可在后台改商户号（services/mini-pay.js）；小程序里不放链接付款（改在服务号菜单）
const { payOrder } = require('../../services/mini-pay')
const WAITING_KEY = 'library_membership_confirming_order'
const WAITING_TTL = 10 * 60 * 1000
const labels = { active: '会员已开通', inactive: '尚未开通', expired: '会员已到期', pending: '订单待支付', refunded: '退款处理中或已退款', closed: '订单已关闭' }

// Visual layout follows the designer's E02 page; tiers, prices and actions come only from the server result.
// 等级按价格往上走（2026-09-24 用户规则）：没开通时所有等级可选；开通后只能选比当前更高的等级升级（按原价购买），不能降级。

// 待支付的那笔会员订单：后端 2026-09-24 起单独返回 pendingOrder（会员升级时 order 仍是已开通的那笔）；
// 旧版后端没有这个字段，未开通且待支付时 order 就是它。
function pendingOrderOf(membership) {
  if (!membership) return null
  if (membership.pendingOrder) return membership.pendingOrder
  return membership.status === 'pending' && membership.order ? membership.order : null
}

// 能买的等级：后端逐个标 purchasable（比已有最高等级更贵）；旧版后端给会员返回空列表。
function purchasableTiers(membership) {
  const tiers = membership && Array.isArray(membership.tiers) ? membership.tiers : []
  return tiers.filter(tier => tier.purchasable !== false)
}

function benefitsView(membership, member, selectedTier) {
  if (selectedTier) return { benefitsHeading: `${selectedTier.name}权益`, benefits: benefitCards(selectedTier, 'preview') }
  if (member.active) return { benefitsHeading: '我的会员权益', benefits: benefitCards(membership && membership.tier, 'owned') }
  return { benefitsHeading: '会员权益', benefits: benefitCards(null, 'none') }
}

function actionView(membership, member, confirming, selectedTierId) {
  const empty = { primaryLabel: '', primaryAction: '', showPlan: false, plans: [], selectedTierId: '' }
  if (!membership) return { ...empty, ...benefitsView(membership, member, null) }
  if (confirming) return { ...empty, primaryLabel: '正在确认支付结果', ...benefitsView(membership, member, null) }
  const tiers = purchasableTiers(membership)
  if (!tiers.length) {
    // 已是最高等级（或后台还没上架等级）：会员直接进课程库。
    return { ...empty, ...(member.active ? { primaryLabel: '进入会员课程库', primaryAction: 'openLibrary' } : {}), ...benefitsView(membership, member, null) }
  }
  const pending = pendingOrderOf(membership)
  const ids = tiers.map(tier => String(tier.productVersionId))
  const pendingTierId = pending ? String(pending.productVersionId || '') : ''
  const selected = ids.includes(String(selectedTierId)) ? String(selectedTierId) : ids.includes(pendingTierId) ? pendingTierId : ids[0]
  const tier = tiers.find(item => String(item.productVersionId) === selected)
  // 价格位数多（如 9800、12800）时卡片里的字号收小一档，见 index.wxss .plan-price-long。
  const plans = tiers.map(item => ({ id: String(item.productVersionId), name: item.name, price: priceText(item.amount), priceLong: priceText(item.amount).length >= 5,
    note: Number(item.creditAmount) > 0 ? `赠送 ${creditsText(item.creditAmount)} 积分` : '永久会员', isSelected: String(item.productVersionId) === selected }))
  const resumable = pending && pending.canPay === true && String(pending.productVersionId) === selected
  const label = resumable ? `继续支付 ¥${priceText(pending.amount)}` : `${member.active ? '再次购买' : '开通'}${tier.name} ¥${priceText(tier.amount)}`
  // 2026-11-10 起没有邀请码 / 推荐人，开通会员不再要求先填码。
  return { primaryLabel: label, primaryAction: 'purchase', showPlan: true, plans, selectedTierId: selected, ...benefitsView(membership, member, tier) }
}

Page({
  data: {
    // loading 只在还没读到过会员状态时为真（显示骨架）；读到过一次后回到页面保留旧状态，后台静默刷新。
    loading: true, loaded: false, paying: false, error: '', notice: '', membership: null, member: membershipView(null), statusLabel: '', expiresText: '', paidText: '', confirming: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, topbarSolid: false,
    // 头像、昵称读到前显示骨架；读取失败才退回中性称呼。
    profileLoaded: false,
    profile: { name: '', initial: '', avatarSrc: '' },
    primaryLabel: '', primaryAction: '', showPlan: false, plans: [], selectedTierId: '', planPressingId: '',
    // 权益区：选中等级时显示该等级的权益，否则是我的会员权益；第一次读到前显示骨架卡片。
    benefitsHeading: '会员权益', benefits: [],
    agreementChecked: false, agreementSheetVisible: false, agreementSheetClosing: false
  },
  onLoad() {
    attachUiAssets(this)
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
    if (!this._paying) return this.refresh()
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
      this.setData({ profileLoaded: true, profile: { name: profile.displayName || '知鹿学员', initial: profile.initial || '鹿', avatarSrc: profile.avatarUrl || '' } })
    } catch (error) {
      // 读取失败：已读到过就保留旧资料，否则退回中性称呼；会员状态单独读取。
      if (!this._disposed && version === this._profileVersion && !this.data.profileLoaded) this.setData({ profileLoaded: true, profile: { name: '知鹿学员', initial: '鹿', avatarSrc: '' } })
    }
  },
  stopPolling() { if (this._timer) clearTimeout(this._timer); this._timer = null },
  applyMembership(membership) {
    const order = membership.order
    // 付款后等回调确认：记下的订单还在待支付就继续确认；已经不在待支付（开通了或关闭了）就清掉记录。
    const pending = pendingOrderOf(membership)
    // 记的是「订单号@开始付款的时间」：超过 10 分钟还没确认就不再锁着页面（2026-11-12：iOS 虚拟支付没弹出就失败时，
    // 旧版不清这条记录，页面一直停在「正在确认支付结果」）。旧版只记订单号、没有时间，按过期处理。
    const [waiting, startedAt] = String(wx.getStorageSync(WAITING_KEY) || '').split('@')
    const fresh = Number(startedAt) > 0 && Date.now() - Number(startedAt) < WAITING_TTL
    const confirming = !!(pending && waiting && fresh && String(pending.orderId) === waiting)
    if (waiting && !confirming) wx.removeStorageSync(WAITING_KEY)
    const member = membershipView(membership)
    this.setData({ membership, member, loaded: true, confirming: !!confirming, statusLabel: confirming ? '正在确认支付结果' : labels[membership.status],
      expiresText: dateText(membership.expiresAt), paidText: dateText(order && order.paidAt), ...actionView(membership, member, !!confirming, this.data.selectedTierId) })
  },
  async refresh(poll = false) {
    if (this._paying || this._disposed) return
    this.stopPolling()
    if (poll !== true) this._attempts = 0
    const version = this._version = (this._version || 0) + 1
    let closed = false
    this.setData({ loading: !this.data.membership, error: '' })
    try {
      // 支付开关（2026-09-30 用户规则）：关着弹「会员功能准备中，敬请期待。」后离开本页，
      // 不读会员状态、不显示等级与价格（弹窗后面仍是骨架）。付款后轮询确认时不再核。
      if (poll !== true) {
        const payment = await checkPaymentPage('membership')
        if (!this._visible || version !== this._version) return
        if (payment === 'closed') { closed = true; return }
        if (payment === 'failed') throw new Error('网络不太稳定，请稍后再试。')
      }
      // 已绑定家长的孩子不能自己付款（2026-11-14 用户规则）：只显示「请家长开通」，不列等级、不能下单
      const membership = await loadCurrentMembership()
      const byGuardian = poll === true ? this.data.guardianPays : await guardianPays()
      if (!this._visible || version !== this._version) return
      this.setData({ guardianPays: !!byGuardian, guardianPaysText: GUARDIAN_PAYS_MESSAGE })
      this.applyMembership(membership)
      if (this.data.confirming) {
        this._attempts = (this._attempts || 0) + 1
        if (this._attempts < 10) this._timer = setTimeout(() => this.refresh(true), 2000)
        else this.setData({ notice: '支付结果尚未确认。如已扣款，请勿重复支付，可稍后重新查询。' })
      } else this.setData({ notice: '' })
    } catch (error) {
      if (this._visible && version === this._version) {
        this.setData({ error: error.message || '会员状态读取失败，请重新查询。' })
        // 第一次就读不到：权益区按未开通的固定结构显示，不再停在骨架。
        if (!this.data.membership) this.setData(benefitsView(null, this.data.member, null))
      }
    } finally {
      if (this._visible && version === this._version && !closed) this.setData({ loading: false })
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
  // 未开通时开通、已开通时升级，都是下一笔会员订单；等级是否比已有的高由服务端判定（MEMBERSHIP_TIER_NOT_HIGHER）。
  // 付款前必须上传本人的微信加好友二维码（2026-11-11 用户规则）：没传就去上传页，传完回来再点开通；读不到不放行。
  async requireWechatQr() {
    try {
      const state = await loadFamilyWechatQr()
      if (state.uploaded) return true
    } catch (error) {
      wx.showToast({ title: error.message || '微信二维码状态暂时读不到，请稍后重试。', icon: 'none' })
      return false
    }
    wx.showModal({
      title: '先上传你的微信二维码',
      content: '开通会员后，客服和导师妈妈会通过它加你微信，为孩子服务。',
      confirmText: '去上传',
      confirmColor: '#FD7C02',
      success: (res) => { if (res.confirm) wx.navigateTo({ url: '/account/wechat-qr/index?from=membership' }) }
    })
    return false
  },
  async purchase() {
    if (this._paying || this.data.confirming || this.data.loading || this.data.error || !this.data.membership || !this.data.selectedTierId) return
    if (this.data.guardianPays) return
    if (this._checkingQr) return
    this._checkingQr = true
    const qrReady = await this.requireWechatQr().finally(() => { this._checkingQr = false })
    if (!qrReady) return
    const selectedTierId = this.data.selectedTierId
    this._paying = true
    this.stopPolling()
    this.setData({ paying: true, notice: '', error: '', agreementChecked: true })
    let order
    let cancelled = false
    let paymentDisabled = false
    try {
      const membership = await createMembershipOrder(selectedTierId)
      if (!this._visible || this._disposed) return
      this.applyMembership(membership)
      order = pendingOrderOf(membership)
      if (!order || order.canPay !== true || String(order.productVersionId) !== selectedTierId) throw new Error('当前订单不能继续付款，请重新查询会员状态。')
      // 小程序里付（虚拟支付 / 商户号支付，services/mini-pay.js）。
      // Persist before opening WeChat so an interrupted app queries the same order first.
      await payOrder(order, 'membership', { onStart: () => wx.setStorageSync(WAITING_KEY, `${order.orderId}@${Date.now()}`) })
    } catch (error) {
      // 停留在页面时后台关了支付开关：下单或发起支付被拒，弹提示后离开
      paymentDisabled = isPaymentDisabled(error)
      cancelled = isWechatPaymentCancelled(error) || error.paymentNotStarted === true
      if (cancelled && order) wx.removeStorageSync(WAITING_KEY)
      if (!this._disposed) this.setData({ notice: isWechatPaymentCancelled(error) ? (this.data.member.active ? '已取消支付，会员等级没有变化。' : '已取消支付，尚未开通会员。') : error.message || '支付结果未确认，请先重新查询。' })
    } finally {
      this._paying = false
      if (!this._disposed) this.setData({ paying: false })
      if (this._visible && order && !cancelled) await this.refresh()
      if (paymentDisabled && this._visible && !this._disposed) showPaymentClosed('membership', leavePaymentPage)
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
  handleBenefitTap(event) {
    const action = event.currentTarget.dataset.action
    if (action === 'openLibrary') return this.openLibrary()
    if (action === 'openProducts') return this.openProducts()
  },
  openLibrary() { wx.navigateTo({ url: '/learning/library/index' }) },
  openOrders() { wx.navigateTo({ url: '/commerce/orders/index' }) },
  openOrder() {
    const order = this.data.membership && this.data.membership.order
    if (order && /^[1-9][0-9]*$/.test(String(order.orderId))) wx.navigateTo({ url: '/commerce/order-detail/index?orderId=' + order.orderId })
  },
  openService() { wx.navigateTo({ url: '/account/service-contact/index' }) }
})
