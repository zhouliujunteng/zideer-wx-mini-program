const { loadCurrentTeacherWorkspace, bindStudentAsCurrentTeacher } = require('../../services/identity')
const { attachUiAssets } = require('../../services/ui-assets')
const { gradeName } = require('../../utils/grade-name')

// 添加学生（老师端，与老师工作台、「我的学生详情」E06 同一套样式）：仅对后台开通的有效老师开放。
// 进入时先核对老师身份，提交由后端再按当前登录身份校验一次；核对期间表单照常显示，只是提交按钮不可点。
// 绑定接口只回姓名、年级、ID，添加成功（或已在名下）后再读一次工作台名单，取这名学生的头像和档案编号，
// 好显示头像、直接进学生详情；名单读不到就只显示文字，不影响添加结果。
Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    checking: true,
    checkFailed: false,
    notTeacher: false,
    code: '',
    submitting: false,
    added: null,
    error: ''
  },
  onLoad() {
    attachUiAssets(this)
    // 顶栏高度对齐胶囊按钮；只在 onLoad 读一次胶囊位置。
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    this.setData({ statusBarHeight, navigationBarHeight: menuButton.height + (menuButton.top - statusBarHeight) * 2 })
    this.checkTeacher()
  },
  async checkTeacher() {
    this.setData({ checking: true, checkFailed: false })
    try {
      const result = await loadCurrentTeacherWorkspace()
      if (result.status !== 'ready') {
        // 入口只对老师显示，走到这里只可能是按路径直接打开或老师刚被停用：与老师工作台一样直接退回。
        this.setData({ notTeacher: true })
        this.leavePage()
      }
    } catch (error) {
      this.setData({ checkFailed: true })
    } finally {
      this.setData({ checking: false })
    }
  },
  handleInput(event) {
    const code = String(event.detail.value || '').replace(/\D/g, '').slice(0, 6)
    this.setData({ code, error: '' })
    return code
  },
  clearCode() {
    this.setData({ code: '', error: '' })
  },
  async submit() {
    if (this.data.submitting || this.data.checking || this.data.notTeacher) return
    const code = this.data.code
    if (!/^\d{6}$/.test(code)) {
      this.setData({ error: '请输入学生的 6 位用户 ID' })
      return
    }
    this.setData({ submitting: true, error: '', added: null })
    try {
      const result = await bindStudentAsCurrentTeacher(code)
      const alreadyBound = result.status === 'already_bound'
      const added = await this.describeStudent(code, result.student, alreadyBound)
      this.setData({ added, code: '' })
      if (!alreadyBound) wx.showToast({ title: '已添加', icon: 'success' })
    } catch (error) {
      if (error.code === 'not_teacher') this.setData({ notTeacher: true })
      this.setData({ error: error.message || '添加学生失败，请稍后重试。' })
    } finally {
      this.setData({ submitting: false })
    }
  },
  // 从工作台名单里找到这名学生，补上头像与档案编号；找不到时用绑定接口回的信息。
  async describeStudent(publicId, student, alreadyBound) {
    let match = null
    try {
      const workspace = await loadCurrentTeacherWorkspace()
      match = (workspace.students || []).find((item) => item.publicId === publicId) || null
    } catch (error) {}
    const source = student || {}
    const fallback = match || {}
    return {
      alreadyBound,
      name: source.name || fallback.name || '未命名学生',
      gradeText: gradeName(source.grade || fallback.grade) || '年级未填',
      publicId,
      avatarUrl: fallback.avatarUrl || '',
      studentProfileId: fallback.studentProfileId || ''
    }
  },
  openAddedStudent() {
    const added = this.data.added
    if (!added || !added.studentProfileId) return
    const query = `studentProfileId=${encodeURIComponent(added.studentProfileId)}&publicId=${encodeURIComponent(added.publicId)}&name=${encodeURIComponent(added.name)}`
    // 换掉本页：从学生详情返回直接回到老师工作台。
    wx.redirectTo({ url: `/teacher/student-detail/index?${query}` })
  },
  continueAdding() {
    this.setData({ added: null, code: '', error: '' })
  },
  leavePage() {
    if (this._leaving) return
    this._leaving = true
    // 切换页面会清掉已弹出的提示，所以等回到上一页再提示。
    const toast = () => wx.showToast({ title: '老师身份已失效', icon: 'none' })
    if (getCurrentPages().length > 1) wx.navigateBack({ complete: toast })
    else wx.switchTab({ url: '/pages/me/index', complete: toast })
  },
  goBack() {
    if (getCurrentPages().length > 1) wx.navigateBack()
    else wx.redirectTo({ url: '/teacher/workspace/index' })
  }
})
