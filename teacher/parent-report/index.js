const {
  loadTeacherParentReports,
  createTeacherParentReport,
  downloadTeacherParentReport,
  deleteTeacherParentReport,
  pushTeacherParentReport
} = require('../../services/identity')
const { decorateReports, pushView } = require('../../utils/parent-report-view')

// 老师工作台 → 学生详情 → 家长学习报告（2026-10-06 用户规则）。
// 老师点「生成新报告」，课程服务后台取这个学生的测评与课程、写老师寄语、排成 PDF（约 1 分钟），每份都留档；
// 这里列出给这个学生出过的全部报告（谁出的都在），每份可以预览、直接发给家长（微信聊天里的文件）；
// 每份还带两段话（发给家长的、发给学生的），完整显示，点一下复制（2026-10-07 用户要求）。
// 「推送家长」（2026-10-08 用户要求）：老师出了报告不一定马上发，点了才推到学生绑定的每位家长的服务号，点开就是这份报告。
// 老师身份与负责关系由课程服务按当前登录账号校验，页面传的 studentProfileId 只是目标。

const POLL_MS = 4000

function errorText(error, fallback) {
  return error && error.message ? error.message : fallback
}

// wx.shareFileMessage 要在点击里直接调；下载完再调可能被拒（不是用户点击触发）
function isGestureError(error) {
  return /TAP|gesture|user.*tap/i.test(String((error && error.errMsg) || ''))
}

function isCancel(error) {
  return /cancel/i.test(String((error && error.errMsg) || ''))
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 82,
    studentName: '',
    loadState: 'loading',
    loadError: '',
    refreshing: false,
    reports: [],
    generating: false,
    creating: false,
    workingId: '',
    workingAction: '',
    // 「推送家长」按钮：后台「活动开关」关了这种服务号通知时课程服务回 pushEnabled: false，按钮不显示
    pushEnabled: true
  },

  onLoad(options = {}) {
    this.studentProfileId = String(options.studentProfileId || '')
    this._files = {}
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const menuButton = wx.getMenuButtonBoundingClientRect
      ? wx.getMenuButtonBoundingClientRect()
      : { top: (windowInfo.statusBarHeight || 20) + 6, height: 32 }
    const statusBarHeight = windowInfo.statusBarHeight || 20
    // 转屏瞬间状态栏高度与胶囊位置可能对不上：间距至少按 4px 算，顶栏高度不会算成负数。
    const navigationBarHeight = menuButton.height + Math.max(4, menuButton.top - statusBarHeight) * 2
    let studentName = ''
    try {
      studentName = options.name ? decodeURIComponent(String(options.name)).slice(0, 20) : ''
    } catch (error) {
      studentName = ''
    }
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + 18, studentName })
  },

  onShow() {
    this._visible = true
    return this.load()
  },

  onHide() {
    this._visible = false
    this.clearPoll()
  },

  onUnload() {
    this._visible = false
    this._unloaded = true
    this.clearPoll()
    // 下载到本地的 PDF 只在本页用，离开就删掉
    const fs = wx.getFileSystemManager ? wx.getFileSystemManager() : null
    Object.values(this._files || {}).forEach((filePath) => {
      if (fs && filePath) fs.unlink({ filePath, fail() {} })
    })
  },

  handleBack() {
    if (getCurrentPages().length > 1) {
      wx.navigateBack({ delta: 1 })
      return
    }
    wx.redirectTo({ url: '/teacher/workspace/index' })
  },

  async handleRefresh() {
    this.setData({ refreshing: true })
    await this.load()
    this.setData({ refreshing: false })
  },

  clearPoll() {
    if (this._pollTimer) clearTimeout(this._pollTimer)
    this._pollTimer = null
  },

  schedulePoll() {
    this.clearPoll()
    if (!this._visible || this._unloaded || !this.data.generating) return
    this._pollTimer = setTimeout(() => {
      this._pollTimer = null
      this.load()
    }, POLL_MS)
  },

  async load() {
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    if (this.data.loadState === 'failed') this.setData({ loadState: 'loading', loadError: '' })
    try {
      const view = await loadTeacherParentReports(this.studentProfileId)
      if (requestId !== this._requestId || this._unloaded) return
      if (view && this.data.pushEnabled !== (view.pushEnabled !== false)) this.setData({ pushEnabled: view.pushEnabled !== false })
      this.apply(view && view.reports)
    } catch (error) {
      if (requestId !== this._requestId || this._unloaded) return
      // 读到过一次后刷新失败：保留页面上的列表，只提示一下（生成中的继续轮询）。
      if (this.data.loadState === 'ready') {
        if (!this.data.generating) wx.showToast({ title: errorText(error, '刷新失败，请稍后重试'), icon: 'none' })
        this.schedulePoll()
        return
      }
      this.setData({ loadState: 'failed', loadError: errorText(error, '请稍后重试。') })
    }
  },

  apply(reports) {
    const list = decorateReports(reports)
    const wasGenerating = this.data.generating
    const generating = list.some((r) => r.status === 'generating')
    this._reports = list
    this.setData({ loadState: 'ready', loadError: '', reports: list, generating })
    // 刚生成好：提示一下，并在后台把这份先下载好，点「发给家长」就能直接发
    if (wasGenerating && !generating && list[0] && list[0].status === 'ready') {
      wx.showToast({ title: '报告已生成', icon: 'success' })
    }
    const newest = list.find((r) => r.status === 'ready')
    if (newest && !this._files[newest.id]) this.prefetch(newest.id)
    this.schedulePoll()
  },

  async prefetch(id) {
    if (this._prefetching === id) return
    this._prefetching = id
    try {
      const filePath = await downloadTeacherParentReport(this.studentProfileId, id)
      if (!this._unloaded) this._files[id] = filePath
    } catch (error) {
      // 预先下载失败不打扰老师，点按钮时再下载并提示
    } finally {
      if (this._prefetching === id) this._prefetching = ''
    }
  },

  async handleCreate() {
    if (this.data.creating) return
    if (this.data.generating) {
      wx.showToast({ title: '这份报告还在生成，请稍等', icon: 'none' })
      return
    }
    this.setData({ creating: true })
    try {
      await createTeacherParentReport(this.studentProfileId)
      if (this._unloaded) return
      wx.showToast({ title: '开始生成，大约 1 分钟', icon: 'none' })
      // 列表里会多出「生成中」的这一份，之后每 4 秒刷新直到生成好
      await this.load()
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: errorText(error, '报告暂时无法生成，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ creating: false })
    }
  },

  // 点一下就复制：老师在微信里粘贴发给家长 / 学生
  handleCopy(event) {
    const dataset = (event && event.currentTarget && event.currentTarget.dataset) || {}
    const report = (this._reports || []).find((r) => r.id === dataset.id)
    const parent = dataset.kind === 'parent'
    const text = report ? (parent ? report.parentNote : report.studentNote) : ''
    if (!text) return
    wx.setClipboardData({
      data: text,
      success: () => wx.showToast({ title: parent ? '已复制，可以粘贴发给家长' : '已复制，可以粘贴发给学生', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请长按文字复制', icon: 'none' })
    })
  },

  // 删除（2026-10-07 用户要求）：家长端「学习报告」与服务号菜单都只给没删掉的报告。留档在课程服务里仍保留。
  handleDelete(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : ''
    const report = (this._reports || []).find((r) => r.id === id && r.status !== 'generating')
    if (!report || this.data.workingId) return
    wx.showModal({
      title: '删除这份报告？',
      content: report.status === 'ready' ? '删除后家长在小程序和服务号里都看不到这份报告。' : '删除这条生成失败的记录。',
      confirmText: '删除',
      confirmColor: '#C4503A',
      success: (res) => { if (res.confirm) this.deleteReport(report) }
    })
  },

  async deleteReport(report) {
    this.setData({ workingId: report.id, workingAction: 'delete' })
    try {
      await deleteTeacherParentReport(this.studentProfileId, report.id)
      if (this._unloaded) return
      const fs = wx.getFileSystemManager ? wx.getFileSystemManager() : null
      if (fs && this._files[report.id]) fs.unlink({ filePath: this._files[report.id], fail() {} })
      delete this._files[report.id]
      wx.showToast({ title: '已删除', icon: 'none' })
      await this.load()
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: errorText(error, '报告没有删除成功，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ workingId: '', workingAction: '' })
    }
  },

  handlePush(event) {
    const report = this.reportOf(event)
    if (!report || this.data.workingId) return
    const view = (this.data.reports || []).find((r) => r.id === report.id)
    if (view && view.pushed) {
      wx.showToast({ title: view.pushText || '已推送过', icon: 'none' })
      return
    }
    wx.showModal({
      title: '推送给家长？',
      content: '会推送到这位学生绑定的每位家长的服务号「知鹿学习」，家长点开就能看这份报告。',
      confirmText: '推送',
      success: (res) => { if (res.confirm) this.pushReport(report) }
    })
  },

  async pushReport(report) {
    this.setData({ workingId: report.id, workingAction: 'push' })
    try {
      const push = await pushTeacherParentReport(this.studentProfileId, report.id)
      if (this._unloaded) return
      const { pushText } = pushView(push)
      if (push.sent && !push.waiting) wx.showToast({ title: pushText, icon: 'none' })
      else wx.showModal({ title: push.sent ? '已推送' : '家长暂时收不到', content: pushText || '稍后会自动补发。', showCancel: false, confirmText: '知道了' })
      await this.load()
    } catch (error) {
      if (!this._unloaded) wx.showToast({ title: errorText(error, '没有推送成功，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ workingId: '', workingAction: '' })
    }
  },

  reportOf(event) {
    const id = event && event.currentTarget && event.currentTarget.dataset ? event.currentTarget.dataset.id : ''
    return (this._reports || []).find((r) => r.id === id && r.status === 'ready') || null
  },

  async fileFor(report) {
    if (this._files[report.id]) return this._files[report.id]
    const filePath = await downloadTeacherParentReport(this.studentProfileId, report.id)
    this._files[report.id] = filePath
    return filePath
  },

  openDocument(filePath, toast) {
    wx.openDocument({
      filePath,
      fileType: 'pdf',
      showMenu: true,
      success: () => { if (toast) wx.showToast({ title: toast, icon: 'none' }) },
      fail: () => wx.showToast({ title: '报告打开失败，请稍后重试', icon: 'none' })
    })
  },

  async handlePreview(event) {
    const report = this.reportOf(event)
    if (!report || this.data.workingId) return
    this.setData({ workingId: report.id, workingAction: 'preview' })
    try {
      this.openDocument(await this.fileFor(report))
    } catch (error) {
      wx.showToast({ title: errorText(error, '报告暂时下载不了，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ workingId: '', workingAction: '' })
    }
  },

  // 发给家长：微信聊天里的文件消息。电脑版等不支持时退回打开报告，从右上角菜单转发。
  shareFile(filePath, report, afterTap) {
    if (!wx.shareFileMessage) {
      this.openDocument(filePath, '点右上角「…」把报告转发给家长')
      return
    }
    wx.shareFileMessage({
      filePath,
      fileName: report.fileName,
      fail: (error) => {
        if (isCancel(error)) return
        if (afterTap && isGestureError(error)) {
          wx.showModal({
            title: '报告已准备好',
            content: '点「发送」选择家长的微信聊天。',
            confirmText: '发送',
            confirmColor: '#FD7C02',
            success: (res) => { if (res.confirm) this.shareFile(filePath, report, false) }
          })
          return
        }
        this.openDocument(filePath, '点右上角「…」把报告转发给家长')
      }
    })
  },

  async handleShare(event) {
    const report = this.reportOf(event)
    if (!report || this.data.workingId) return
    const cached = this._files[report.id]
    if (cached) {
      this.shareFile(cached, report, false)
      return
    }
    this.setData({ workingId: report.id, workingAction: 'share' })
    try {
      const filePath = await this.fileFor(report)
      if (!this._unloaded) this.shareFile(filePath, report, true)
    } catch (error) {
      wx.showToast({ title: errorText(error, '报告暂时下载不了，请稍后重试'), icon: 'none' })
    } finally {
      if (!this._unloaded) this.setData({ workingId: '', workingAction: '' })
    }
  }
})
