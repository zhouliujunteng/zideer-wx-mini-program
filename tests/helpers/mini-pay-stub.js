// 页面测试用的付款方式替身（services/mini-pay.js）：
//   安卓（webPay 替身 android: true）→ 打开链接付款等待页，回 'web'；其余调页面替身里的 payWechatOrder，回 'merchant'。
//   payByLink 一律打开链接付款等待页。真实实现在 tests/mini-pay.test.js 里测。
module.exports = function miniPayStub(api, webPay) {
  return {
    platform: () => (webPay.shouldPayOnWeb() ? 'android' : 'ios'),
    async payOrder(order, kind, { onStart } = {}) {
      if (webPay.shouldPayOnWeb()) {
        webPay.openWebPay(order.orderId, kind)
        return 'web'
      }
      if (typeof onStart === 'function') onStart()
      await api().payWechatOrder(order)
      return 'merchant'
    },
    async payByLink(orderId, kind, options) {
      return webPay.openWebPay(orderId, kind, options)
    }
  }
}
