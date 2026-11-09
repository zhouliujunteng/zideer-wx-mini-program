// 页面测试用的支付开关替身（services/payment-switch.js）：默认开着，跳转走测试自己的 wx。
// 只测页面业务的测试在 require 替身里遇到 /payment-switch 时返回它；开关本身在 tests/payment-switch.test.js 里用真实实现测。
//   paymentSwitchStub(() => wx, { enabled: false })  关着：入口只记下弹了哪种提示，不跳转；页面核对返回 'closed'
module.exports = function paymentSwitchStub(getWx, { enabled = true } = {}) {
  const closed = []
  const wx = () => (typeof getWx === 'function' ? getWx() : getWx)
  return {
    closed,
    loadPaymentSwitch: async () => enabled,
    knownPaymentOpen: () => enabled,
    attachPaymentSwitch: (page) => { if (page && typeof page.setData === 'function') page.setData({ paymentOpen: enabled }); return Promise.resolve() },
    paymentClosedMessage: (kind) => (kind === 'credits' ? '积分包购买准备中，敬请期待。' : '会员功能准备中，敬请期待。'),
    showPaymentClosed: (kind, onClose) => { closed.push(kind); if (typeof onClose === 'function') onClose() },
    isPaymentDisabled: (error) => !!error && error.code === 'PAYMENT_DISABLED',
    confirmPaymentOpen: async (kind = 'membership') => { if (!enabled) closed.push(kind); return enabled },
    openPaymentPage: async (url, kind = 'membership', { redirect = false } = {}) => {
      if (!enabled) { closed.push(kind); return false }
      if (redirect) wx().redirectTo({ url })
      else wx().navigateTo({ url })
      return true
    },
    checkPaymentPage: async (kind = 'membership') => { if (enabled) return 'open'; closed.push(kind); return 'closed' },
    leavePaymentPage: () => {},
    assertPaymentOpen: async () => {
      if (!enabled) throw Object.assign(new Error('支付功能准备中，敬请期待。'), { code: 'PAYMENT_DISABLED', paymentNotStarted: true })
    },
    resetPaymentSwitchCache: () => {}
  }
}
