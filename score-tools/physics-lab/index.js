const config = require('../../config/index')

// 首页「物理实验室」：课程站上的静态网页（源码在项目 physics-lab/，引擎来自开源项目 PhysicsOS），用 web-view 打开。
// 网页全在浏览器里算，不登录、不读数据，所以游客也能进（services/identity.js 的 GUEST_BROWSABLE_ROUTES）。
// ?stage=senior 打开高中实验（首页按学生年级传），?exp=<实验编号> 直接打开某个实验。
function labUrl(options = {}) {
  const query = [`stage=${options.stage === 'senior' ? 'senior' : 'junior'}`]
  if (/^[a-z0-9-]{1,64}$/.test(String(options.exp || ''))) query.push(`exp=${options.exp}`)
  return `${config.PHYSICS_LAB_URL}?${query.join('&')}`
}

Page({
  data: { launchUrl: '', failed: false, errorMessage: '' },

  onLoad(options = {}) {
    this._url = labUrl(options)
    this.setData({ launchUrl: this._url })
  },

  retry() {
    // web-view 只在 src 变化时重新加载，所以重试时换一个时间戳参数。
    this.setData({ failed: false, errorMessage: '', launchUrl: `${this._url}&t=${Date.now()}` })
  },

  onWebViewError(event = {}) {
    const detail = event.detail || {}
    if (detail.src && detail.src !== this.data.launchUrl) return
    const message = String(detail.errMsg || detail.errmsg || '')
    const code = String(detail.errCode || detail.errcode || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32)
    const errorMessage = /domain.*(list|allow)|业务域名|域名.*(配置|不|限制)/i.test(message)
      ? '微信限制了网页访问，需要把课程站配置为小程序业务域名。'
      : `微信未能加载物理实验室${code ? `（错误码 ${code}）` : ''}，请切换网络后重试。`
    // 与课程页一致：binderror 里不要卸载 web-view，真机上会和微信的路由清理抢时序。
    this.setData({ failed: true, errorMessage })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/home/index' })
    })
  },

  onShareAppMessage() {
    return { title: '物理实验室：76 个初高中物理实验，动手调参数看现象', path: '/score-tools/physics-lab/index' }
  }
})
