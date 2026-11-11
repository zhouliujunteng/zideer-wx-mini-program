const { loadAgentFamilies, lookupAgentFamily, bindAgentFamily } = require('../../services/identity')
const { rpxToPx } = require('../../utils/screen')
const { gradeName } = require('../../utils/grade-name')

// 绑定家庭（2026-11-10 用户规则，替代原来的邀请码）：爱心妈妈、团长输入家长的用户 ID → 先看是谁和孩子 → 确认绑定。
// 一个家庭只能被一个人绑，绑定后自己不能改（管理员后台可以改）；不能绑自己家。家长不用同意，会收到服务号通知。
// 课程服务 /api/learn/agent-family（lib/agent-roles/family.ts）判断所有规则，这里只展示。
function gradeText(grade) { return grade ? gradeName(grade) : '' }
function childrenText(children) {
  if (!children || !children.length) return '还没有绑定孩子'
  return children.map((c) => [c.name, gradeText(c.grade)].filter(Boolean).join(' · ')).join('，')
}
function dateText(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}
function familiesView(list) {
  return (list || []).map((item) => ({ ...item, childrenText: childrenText(item.children), dateText: dateText(item.boundAt) }))
}

Page({
  data: {
    statusBarHeight: 20,
    navigationBarHeight: 44,
    contentTop: 80,
    loaded: false,
    loadFailed: false,
    errorMessage: '',
    canBind: false,
    families: [],
    publicId: '',
    looking: false,
    lookupError: '',
    candidate: null,
    binding: false
  },
  onLoad() {
    const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
    const statusBarHeight = windowInfo.statusBarHeight || 20
    const menuButton = wx.getMenuButtonBoundingClientRect ? wx.getMenuButtonBoundingClientRect() : { top: statusBarHeight + 6, height: 32 }
    const navigationBarHeight = menuButton.height + (menuButton.top - statusBarHeight) * 2
    this.setData({ statusBarHeight, navigationBarHeight, contentTop: statusBarHeight + navigationBarHeight + rpxToPx(12, windowInfo.windowWidth || 375) })
  },
  onShow() { this.load() },
  async load() {
    try {
      const result = await loadAgentFamilies()
      this.setData({ loaded: true, loadFailed: false, canBind: !!result.canBind, families: familiesView(result.families) })
    } catch (error) {
      if (this.data.loaded) return wx.showToast({ title: error.message || '绑定的家庭暂时无法读取', icon: 'none' })
      this.setData({ loadFailed: true, errorMessage: error.message || '绑定的家庭暂时无法读取，请稍后重试。' })
    }
  },
  retry() { this.setData({ loadFailed: false }); this.load() },
  handleBack() {
    if (getCurrentPages().length > 1) return wx.navigateBack({ delta: 1 })
    wx.switchTab({ url: '/pages/me/index' })
  },
  // 点一个家庭：进免费体验（免费测评、报告与话术、诊断会议、免费课），2026-11-11
  openFamily(event) {
    const id = event.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/agent/family-trial/index?guardianPublicId=${id}` })
  },
  handleInput(event) {
    this.setData({ publicId: String(event.detail.value || '').replace(/\D/g, ''), lookupError: '', candidate: null })
  },
  async handleLookup() {
    const publicId = this.data.publicId
    if (this.data.looking) return
    if (!/^\d{4,12}$/.test(publicId)) return this.setData({ lookupError: '请输入家长的用户 ID（「我的」页头像下方的数字）' })
    this.setData({ looking: true, lookupError: '', candidate: null })
    try {
      const result = await lookupAgentFamily(publicId)
      this.setData({ candidate: { ...result.person, childrenText: childrenText(result.children) } })
    } catch (error) {
      this.setData({ lookupError: error.message || '暂时查不到这个用户，请稍后重试。' })
    } finally {
      this.setData({ looking: false })
    }
  },
  handleBind() {
    const candidate = this.data.candidate
    if (!candidate || this.data.binding) return
    wx.showModal({
      title: '确认绑定这个家庭？',
      content: `${candidate.name}（ID ${candidate.publicId}）。绑定后不能自己修改或解绑，如需调整请联系平台。`,
      confirmText: '确认绑定',
      confirmColor: '#FD7C02',
      success: async (res) => {
        if (!res.confirm) return
        this.setData({ binding: true })
        try {
          const result = await bindAgentFamily(candidate.publicId)
          this.setData({ families: familiesView(result.families), candidate: null, publicId: '' })
          wx.showToast({ title: '已绑定', icon: 'success' })
        } catch (error) {
          this.setData({ lookupError: error.message || '绑定没有成功，请稍后重试。', candidate: null })
        } finally {
          this.setData({ binding: false })
        }
      }
    })
  }
})
