// 页面测试用的付款方式替身（services/mini-pay.js）：调页面替身里的 payWechatOrder，回 'merchant'。
// 小程序里不再有链接付款（2026-11-13）。真实实现在 tests/mini-pay.test.js 里测。
module.exports = function miniPayStub(api) {
  return {
    platform: () => 'ios',
    async payOrder(order, kind, { onStart } = {}) {
      if (typeof onStart === 'function') onStart()
      await api().payWechatOrder(order)
      return 'merchant'
    }
  }
}
