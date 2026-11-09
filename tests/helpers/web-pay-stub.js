// 页面测试用的网页付款替身（services/web-pay.js）：默认不是安卓，页面照旧走小程序内支付。
//   webPayStub(() => wx, { android: true })  安卓：付款入口改为打开网页付款等待页，记下打开了哪笔订单
// 真实实现在 tests/web-pay.test.js 里测。
module.exports = function webPayStub(getWx, { android = false } = {}) {
  const opened = []
  const wx = () => (typeof getWx === 'function' ? getWx() : getWx)
  return {
    opened,
    shouldPayOnWeb: () => android,
    openWebPay: (orderId, kind, { redirect = false } = {}) => {
      opened.push({ orderId: String(orderId), kind, redirect })
      const url = `/commerce/web-pay/index?orderId=${orderId}&kind=${kind}`
      const target = wx()
      if (redirect && target && target.redirectTo) target.redirectTo({ url })
      else if (!redirect && target && target.navigateTo) target.navigateTo({ url })
    },
    createWebPayLink: async () => { throw new Error('web pay link not stubbed') },
    loadWebPayStatus: async () => { throw new Error('web pay status not stubbed') }
  }
}
