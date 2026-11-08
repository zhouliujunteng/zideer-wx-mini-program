const supportDiagnostics = require('../../utils/support-diagnostics')
const { createCourseLaunchUrl, createLibraryCourseLaunchUrl, createAgentCourseLaunchUrl } = require('../../services/identity')

// 课程只能在小程序里学：课程网页没有别的登录方式，所以这里不提供「复制链接到浏览器打开」。
Page({
  data: {
    loading: true,
    failed: false,
    launchUrl: '',
    errorMessage: ''
  },

  onLoad(options = {}) {
    supportDiagnostics.record('course-entry')
    this._unloaded = false
    this.courseInstanceId = String(options.courseInstanceId || '')
    this.libraryCourseId = String(options.libraryCourseId || '')
    this.agentCourseId = String(options.agentCourseId || '')
    // 课程详情页点了某一页：从这一页开始学（只对定制课程）
    this.sceneId = String(options.sceneId || '')
    this.loadCourse()
  },

  onUnload() { supportDiagnostics.record('course-exit'); this._unloaded = true },

  async loadCourse() {
    if (this._unloaded) return
    const version = this._loadVersion = (this._loadVersion || 0) + 1
    this.setData({ loading: true, failed: false, launchUrl: '', errorMessage: '' })
    try {
      if ([this.courseInstanceId, this.libraryCourseId, this.agentCourseId].filter(Boolean).length > 1) throw new Error('课程入口无效，请返回后重试。')
      const launchUrl = this.agentCourseId
        ? await createAgentCourseLaunchUrl(this.agentCourseId, this.sceneId)
        : this.libraryCourseId
          ? await createLibraryCourseLaunchUrl(this.libraryCourseId)
          : await createCourseLaunchUrl(this.courseInstanceId)
      if (!this._unloaded && version === this._loadVersion) this.setData({ launchUrl })
    } catch (error) {
      if (this._unloaded || version !== this._loadVersion) return
      this.setData({ failed: true, errorMessage: error.message || '课程入口暂时不可用，请返回任务页刷新。' })
      wx.showToast({ title: error.message || '课程暂时无法进入', icon: 'none' })
    } finally {
      if (!this._unloaded && version === this._loadVersion) this.setData({ loading: false })
    }
  },

  retry() {
    return this.loadCourse()
  },

  onWebViewError(event = {}) {
    if (this._unloaded) return
    const detail = event.detail || {}
    if (detail.src && detail.src !== this.data.launchUrl) return
    supportDiagnostics.record('webview', 'webview')
    const message = String(detail.errMsg || detail.errmsg || '')
    const code = String(detail.errCode || detail.errcode || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0,32)
    const errorMessage = /domain.*(list|allow)|业务域名|域名.*(配置|不|限制)/i.test(message)
      ? '微信限制了课程网页访问，需要将课程站点配置为小程序业务域名。'
      : /ssl|certificate|cert_|证书/i.test(message)
        ? '课程站点的安全连接未通过微信验证，请联系管理员检查证书。'
        : `微信未能加载课程网页${code ? `（错误码 ${code}）` : ''}。请切换网络后重试。`
    // Keep the web-view mounted while handling its own error callback. Removing
    // it from inside binderror can race WeChat's route cleanup and produce
    // "webviewId ... is not found" on real devices.
    this.setData({ loading: false, failed: true, errorMessage })
    if (wx.setStorageSync) wx.setStorageSync('last_course_entry_error', {
      courseInstanceId: this.courseInstanceId, code, kind: /业务域名/.test(errorMessage) ? 'domain' : /证书/.test(errorMessage) ? 'certificate' : 'webview', at: new Date().toISOString()
    })
  },

  goBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.switchTab({ url: '/pages/learning/index' })
    })
  }
})
