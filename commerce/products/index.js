const { loadCreditProducts, loadPurchaseEligibility, bindCurrentPromotionCode } = require('../../services/identity')
const { clearPendingReferral } = require('../../utils/referral-context')
const { attachUiAssets } = require('../../services/ui-assets')
const { priceText } = require('../../services/membership-view')
const { rpxToPx } = require('../../utils/screen')
const { checkPaymentPage, openPaymentPage } = require('../../services/payment-switch')

// 积分包（PRD M28 课程积分商城）：会员中心「积分包」点进来的二级页。设计仓库没有这页的稿子，
// 按设计师已做页面的规则做：课程积分页（M34）的顶部余额与氛围、会员中心（E02）的「上面选、下面看、底部买」。
// 选中积分包的有效期、教师服务、退款规则直接显示在本页（原 M29 商品详情的内容），购买直接进确认订单。

function ruleText(rule, fallback) {
  if (!rule || typeof rule !== 'object') return fallback
  return rule.description || rule.summary || rule.label || fallback
}

function packCards(products, selectedId) {
  return products.map((item) => ({
    id: String(item.id),
    name: item.name,
    credits: item.credits,
    price: priceText(item.payableAmount),
    listPrice: item.memberPriceApplied ? priceText(item.amount) : '',
    memberTag: item.memberPriceApplied ? '会员价' : item.memberAmount ? `会员价 ¥${priceText(item.memberAmount)}` : '',
    memberApplied: item.memberPriceApplied,
    courseText: item.estimatedCourseCount ? `约 ${item.estimatedCourseCount} 节课程` : '',
    isSelected: String(item.id) === selectedId
  }))
}

function selectedView(products, selectedId) {
  const product = products.find((item) => String(item.id) === selectedId)
  if (!product) return { selected: null }
  const saved = product.memberPriceApplied ? Number(product.amount) - Number(product.payableAmount) : 0
  return {
    selected: {
      id: String(product.id),
      name: product.name,
      description: product.description || '',
      credits: product.credits,
      price: priceText(product.payableAmount),
      savedText: saved > 0 ? `已享会员价，省 ¥${priceText(saved)}` : '',
      rows: [
        { label: '预计课程数', value: product.estimatedCourseCount ? `约 ${product.estimatedCourseCount} 节` : '以学习规划为准' },
        { label: '有效期', value: ruleText(product.validityRule, '以积分包公布的有效期规则为准') },
        { label: '教师服务', value: ruleText(product.serviceRule, '以积分包公布的服务规则为准') },
        { label: '退款规则', value: ruleText(product.refundRule, '支付成功 7 日内可申请退款，超过 7 日不支持') }
      ]
    }
  }
}

Page({
  // 第一次读到积分包前显示骨架；读到过一次后回到页面保留旧列表，后台静默刷新。
  data: {
    loaded: false, failed: false, eligible: false, products: [], packs: [], selectedId: '', selected: null,
    balance: null, buyerIsMember: false, memberOffer: false,
    statusBarHeight: 20, navigationBarHeight: 44, contentTop: 80, topbarSolid: false
  },
  onLoad(options = {}) {
    attachUiAssets(this)
    this.preselectId = String(options.productVersionId || '')
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() { this.loadPage() },
  async loadPage() {
    if (!this.data.loaded) this.setData({ failed: false })
    // 支付开关（2026-09-30 用户规则）：关着弹提示后离开本页，不读积分包
    const payment = await checkPaymentPage('credits')
    if (payment === 'closed') return
    if (payment === 'failed') {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: '网络不太稳定，请稍后再试。', icon: 'none' })
      return
    }
    try {
      const eligibility = await loadPurchaseEligibility()
      const balance = eligibility.balance || null
      if (!eligibility.eligible) {
        this.setData({ eligible: false, products: [], packs: [], selected: null, balance, loaded: true })
        return
      }
      const data = await loadCreditProducts()
      const products = data.products || []
      const ids = products.map((item) => String(item.id))
      const wanted = this.data.selectedId || this.preselectId
      const selectedId = ids.includes(wanted) ? wanted : ids[0] || ''
      this.setData({
        eligible: true, products, balance, buyerIsMember: data.buyerIsMember === true,
        // 非会员且有积分包设了会员价：提示去开通会员。
        memberOffer: data.buyerIsMember !== true && products.some((item) => item.memberAmount),
        selectedId, packs: packCards(products, selectedId), ...selectedView(products, selectedId), loaded: true
      })
    } catch (error) {
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '积分包加载失败', icon: 'none' })
    }
  },
  // 内容滚到顶栏下面时顶栏变实色（同会员中心）。
  handleScroll(event) {
    const topbarSolid = event.detail.scrollTop > 12
    if (topbarSolid !== this.data.topbarSolid) this.setData({ topbarSolid })
  },
  selectPack(event) {
    const selectedId = String(event.currentTarget.dataset.id || '')
    if (!selectedId || selectedId === this.data.selectedId) return
    this.setData({ selectedId, packs: packCards(this.data.products, selectedId), ...selectedView(this.data.products, selectedId) })
  },
  buy() {
    if (!this.data.selected) return
    return openPaymentPage(`/commerce/order-confirm/index?productVersionId=${encodeURIComponent(this.data.selected.id)}`, 'credits')
  },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  // 没有推荐人：与会员中心同一个填码框（AF46 bind，填后不可更改），绑定成功后刷新即可购买（2026-09-25 用户规则）
  openInviteCode() {
    if (this._inviting) return
    this._inviting = true
    wx.showModal({
      // 可输入的弹窗里 content 是输入框的初始文字，不是说明：不传 content。「填写后不可更改」写在页面上，
      // 占位文字放不下（弹窗输入框一行约 13 个字）
      title: '填写邀请码后购买',
      editable: true,
      placeholderText: '输入邀请人的邀请码',
      confirmText: '绑定',
      success: async (result) => {
        const code = result.confirm ? String(result.content || '').trim() : ''
        if (!code) { this._inviting = false; return }
        try {
          const bound = await bindCurrentPromotionCode(code)
          clearPendingReferral()
          wx.showToast({ title: bound.rewardCredits > 0 ? `绑定成功，获得 ${bound.rewardCredits} 积分` : '已绑定推荐人，可以购买积分包了', icon: 'none', duration: 2400 })
        } catch (error) {
          if (error && error.terminalReferral) clearPendingReferral()
          wx.showToast({ title: error.message || '绑定失败', icon: 'none', duration: 2600 })
        } finally {
          this._inviting = false
          await this.loadPage()
        }
      },
      fail: () => { this._inviting = false }
    })
  },
  openEligibility() { wx.navigateTo({ url: '/commerce/agent-gate/index' }) },
  openAccount() { wx.navigateTo({ url: '/commerce/entitlements/index' }) },
  openMembership() { return openPaymentPage('/commerce/membership/index', 'membership') }
})
