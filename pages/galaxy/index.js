const config = require('../../config/index')

// 官网知识星河（website/galaxy.html）用 web-view 打开。带 from=miniprogram，
// 网页据此隐藏右上角「返回官网」——小程序里回退用微信自带的返回。
Page({
  data: { launchUrl: '', failed: false, errorMessage: '' },

  onLoad() {
    this.setData({ launchUrl: config.GALAXY_URL })
  },

  retry() {
    // web-view 只在 src 变化时重新加载，所以重试时换一个时间戳参数。
    this.setData({ failed: false, errorMessage: '', launchUrl: `${config.GALAXY_URL}&t=${Date.now()}` })
  },

  onWebViewError(event = {}) {
    const detail = event.detail || {}
    if (detail.src && detail.src !== this.data.launchUrl) return
    const message = String(detail.errMsg || detail.errmsg || '')
    const code = String(detail.errCode || detail.errcode || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    const errorMessage = /domain.*(list|allow)|业务域名|域名.*(配置|不|限制)/i.test(message)
      ? '微信限制了官网网页访问，需要把官网站点配置为小程序业务域名。'
      : /ssl|certificate|cert_|证书/i.test(message)
        ? '官网站点的安全连接未通过微信验证，请联系管理员检查证书。'
        : `微信未能加载知识星河${code ? `（错误码 ${code}）` : ''}。请切换网络后重试，也可复制链接到浏览器打开。`
    // 与课程页一致：binderror 里不要卸载 web-view，真机上会和微信的路由清理抢时序。
    this.setData({ failed: true, errorMessage })
  },

  copyGalaxyLink() {
    wx.setClipboardData({ data: config.GALAXY_URL })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.redirectTo({ url: '/pages/knowledge-map/index' })
    })
  }
})
