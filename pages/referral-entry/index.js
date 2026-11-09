const { captureReferralContext } = require('../../utils/referral-context')

// 推广伙伴的分享卡片与海报链接由后端签发，地址固定指向这里，已经发出去的不能失效，
// 所以路由保留、页面不再有内容：接住邀请参数就把人送回首页，
// 绑定推荐人（以及深测资格领取）由首页在后台静默完成。
Page({
  onLoad(options = {}) {
    captureReferralContext(options)
    wx.reLaunch({ url: '/pages/home/index' })
  }
})
