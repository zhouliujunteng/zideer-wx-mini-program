// 积分包付款成功后直接回首页（2026-09-25 用户要求），不再停在订单状态页。
// 微信支付返回成功时，积分还要等服务端支付回调发放（通常几秒内），所以提示写「稍后到账」。
function goHomeAfterCreditPayment() {
  wx.switchTab({
    url: '/pages/home/index',
    success: () => wx.showToast({ title: '支付成功，积分稍后到账', icon: 'none', duration: 2400 })
  })
}

module.exports = { goHomeAfterCreditPayment }
