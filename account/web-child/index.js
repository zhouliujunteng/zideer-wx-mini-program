const { loadWebChildren, createWebChild, setWebChildPassword } = require('../../services/identity')

// 家长「我的孩子没有微信」（2026-10-09 用户需求）：孩子没有手机 / 微信时，家长给孩子建网页端账号，孩子在电脑或平板上学。
// 登录名是孩子的 6 位编号，密码家长设；一个家长最多 5 个孩子。服务商（2026-10-11）不受 5 个限制，按后台设的上限，
// 绑定码绑的孩子和这里建的合计（provider.used），所以服务商看名额用 provider，不用 children.length。同一个孩子一年内最多在 3 台设备上登录，
// 超出会被锁住，只有客服（管理端）能解除。后端：课程服务 lib/portal/child-accounts.ts + Zion「家长管理无微信孩子」。
const WEB_URL = 'study.zideer.cn'
const gradeOptions = Array.from({ length: 12 }, (_, i) => i + 1)
const gradeLabels = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三', '高一', '高二', '高三']
const semesterOptions = ['上学期', '下学期']
const textbookOptions = ['人教版', '北师大版', '苏教版', '沪教版', '鲁教版', '统编版', '浙教版', '其他版本']

function newRequestKey() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let key = 'wc'
  for (let i = 0; i < 30; i++) key += chars[Math.floor(Math.random() * chars.length)]
  return key
}

function passwordProblem(password) {
  if (password.length < 8 || password.length > 64) return '密码要 8～64 位。'
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return '密码要同时包含字母和数字。'
  if (/\s/.test(password)) return '密码里不能有空格。'
  return ''
}

function childView(child) {
  const grade = Number(child.grade)
  return {
    ...child,
    gradeText: grade >= 1 && grade <= 12 ? `${gradeLabels[grade - 1]}${child.semester || ''}` : '',
    statusText: child.locked ? '已锁定' : child.ready ? '可以登录' : '未创建完成',
    deviceText: `${child.deviceCount || 0}/${child.deviceLimit || 3} 台设备`
  }
}

const emptyForm = () => ({ nickname: '', gradeIndex: -1, semesterIndex: -1, textbookIndex: -1, schoolName: '', regionDetail: '', password: '', confirm: '' })

Page({
  data: {
    webUrl: WEB_URL,
    gradeLabels,
    semesterOptions,
    textbookOptions,
    loaded: false,
    failed: false,
    children: [],
    max: 5,
    provider: null,
    formOpen: false,
    form: emptyForm(),
    submitting: false,
    created: null,
    gate: null,
    passwordFor: null,
    newPassword: '',
    savingPassword: false
  },

  onShow() { return this.loadPage() },

  async loadPage() {
    const requestId = this._requestId = (this._requestId || 0) + 1
    this.setData({ failed: false })
    try {
      const result = await loadWebChildren()
      if (requestId !== this._requestId) return
      const provider = result.provider ? { limit: Number(result.provider.limit) || 0, used: Number(result.provider.used) || 0 } : null
      this.setData({ loaded: true, children: (result.children || []).map(childView), max: result.max || 5, provider })
    } catch (error) {
      if (requestId !== this._requestId) return
      if (!this.data.loaded) this.setData({ failed: true })
      wx.showToast({ title: error.message || '孩子的网页端账号暂时读不到', icon: 'none' })
    }
  },

  openForm() {
    const provider = this.data.provider
    if (provider && provider.used >= provider.limit) {
      wx.showToast({ title: `已绑定 ${provider.used} 个孩子，达到上限 ${provider.limit} 个，需要更多名额请联系知鹿调整`, icon: 'none' })
      return
    }
    if (!provider && this.data.children.length >= this.data.max) {
      wx.showToast({ title: `每位家长最多给 ${this.data.max} 个孩子创建账号`, icon: 'none' })
      return
    }
    this._requestKey = newRequestKey()
    this.setData({ formOpen: true, form: emptyForm(), created: null, gate: null })
  },

  closeForm() { this.setData({ formOpen: false }) },

  onField(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: String(event.detail.value || '') })
  },

  onPick(event) {
    const key = event.currentTarget.dataset.key
    this.setData({ [`form.${key}`]: Number(event.detail.value) })
  },

  async submit() {
    if (this.data.submitting) return
    const form = this.data.form
    const nickname = form.nickname.trim()
    let problem = ''
    if (!nickname) problem = '请填写孩子的称呼。'
    else if (form.gradeIndex < 0) problem = '请选择孩子的年级。'
    else if (form.semesterIndex < 0) problem = '请选择上学期或下学期。'
    else if (form.textbookIndex < 0) problem = '请选择孩子用的教材版本。'
    else if (!form.schoolName.trim()) problem = '请填写孩子就读的学校。'
    else if (!form.regionDetail.trim()) problem = '请填写孩子所在的城市。'
    else problem = passwordProblem(form.password) || (form.password !== form.confirm ? '两次输入的密码不一样。' : '')
    if (problem) return wx.showToast({ title: problem, icon: 'none' })

    this.setData({ submitting: true })
    try {
      // 请求编号整次表单不变：网络断了重试也不会建出两个孩子
      const result = await createWebChild({
        requestKey: this._requestKey,
        nickname,
        grade: gradeOptions[form.gradeIndex],
        semester: semesterOptions[form.semesterIndex],
        textbookVersion: textbookOptions[form.textbookIndex],
        schoolName: form.schoolName.trim(),
        regionDetail: form.regionDetail.trim(),
        password: form.password
      })
      this.setData({ formOpen: false, form: emptyForm(), created: result.child })
      this.loadPage()
    } catch (error) {
      if (error && (error.code === 'GUARDIAN_VERIFICATION_REQUIRED' || error.code === 'GUARDIAN_AGE_UNKNOWN'))
        this.setData({ gate: { title: '先完成实名认证', detail: error.message, actionLabel: '去实名认证' } })
      else if (error && error.code === 'GUARDIAN_UNDERAGE')
        this.setData({ gate: { title: '暂不能创建账号', detail: error.message, actionLabel: '' } })
      wx.showToast({ title: error.message || '孩子的账号没有创建成功', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  openVerification() { wx.navigateTo({ url: '/account/login-identities/index?verify=1' }) },

  copyLogin(event) {
    const id = event.currentTarget.dataset.id
    wx.setClipboardData({ data: `知鹿学习网页版：${WEB_URL}\n登录账号：${id}\n密码：家长设置的密码` })
  },

  openPassword(event) {
    this.setData({ passwordFor: event.currentTarget.dataset.id, newPassword: '' })
  },

  closePassword() { this.setData({ passwordFor: null, newPassword: '' }) },

  onNewPassword(event) { this.setData({ newPassword: String(event.detail.value || '') }) },

  async savePassword() {
    if (this.data.savingPassword) return
    const problem = passwordProblem(this.data.newPassword)
    if (problem) return wx.showToast({ title: problem, icon: 'none' })
    this.setData({ savingPassword: true })
    try {
      await setWebChildPassword(this.data.passwordFor, this.data.newPassword)
      this.setData({ passwordFor: null, newPassword: '' })
      wx.showToast({ title: '密码已修改，已登录的设备需要重新登录', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: error.message || '密码没有改成功', icon: 'none' })
    } finally {
      this.setData({ savingPassword: false })
    }
  }
})
