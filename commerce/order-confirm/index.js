const {
  loadCreditProduct,
  loadCurrentUser,
  createSecureCreditOrder,
  payWechatOrder,
  isWechatPaymentCancelled
} = require('../../services/identity')

Page({
  data: { loading: true, failed: false, submitting: false, product: null, beneficiary: null },
  onLoad(options) {
    this.productVersionId = options.productVersionId || ''
    this.pendingOrder = null
  },
  onShow() { this.loadPage() },
  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      const [product, currentUser] = await Promise.all([loadCreditProduct(this.productVersionId), loadCurrentUser()])
      if (!currentUser.profileCompleted || !currentUser.profile) throw new Error('请先完善学习档案后购买。')
      this.setData({ product, beneficiary: { id: currentUser.profile.id, name: currentUser.profile.nickname || currentUser.profile.real_name || '当前学生' } })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '订单信息加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },
  async createOrder() {
    if (this.data.submitting || !this.data.product || !this.data.beneficiary) return
    this.setData({ submitting: true })
    let createdOrder = null
    try {
      const order = this.pendingOrder || await createSecureCreditOrder(this.data.product.id, this.data.beneficiary.id)
      createdOrder = order
      this.pendingOrder = order
      await payWechatOrder({
        orderId: order.orderId,
        amount: order.amount,
        description: order.description || this.data.product.name
      })
      const query = `orderId=${encodeURIComponent(order.orderId)}&orderNo=${encodeURIComponent(order.orderNo)}&amount=${encodeURIComponent(order.amount)}`
      wx.redirectTo({ url: `/commerce/payment-result/index?${query}` })
    } catch (error) {
      if (isWechatPaymentCancelled(error)) {
        wx.showToast({ title: '已取消支付，可在订单详情继续支付', icon: 'none' })
        if (createdOrder) {
          const query = `orderId=${encodeURIComponent(createdOrder.orderId)}&orderNo=${encodeURIComponent(createdOrder.orderNo)}&amount=${encodeURIComponent(createdOrder.amount)}`
          wx.redirectTo({ url: `/commerce/payment-result/index?${query}` })
        }
      } else {
        wx.showToast({ title: error.message || '订单创建或支付失败', icon: 'none' })
      }
    } finally {
      this.setData({ submitting: false })
    }
  }
})
