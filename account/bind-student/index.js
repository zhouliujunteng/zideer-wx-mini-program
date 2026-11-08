const { bindCurrentGuardianToStudent, loadCurrentIdentityVerification, loadWebChildren } = require('../../services/identity')

// 家长绑定学生前必须先完成实名认证（2026-09-24 用户规则）。后端绑定流程本来就会拒绝未认证的家长，
// 这里在输入绑定码之前先查状态：未认证只显示「先完成实名认证」，不让家长白输一遍码。
const gateCopy = {
  not_started: { title: '先完成实名认证', detail: '为保护学生信息，家长完成实名认证后才能绑定学生。', actionLabel: '去实名认证' },
  pending: { title: '实名认证审核中', detail: '审核通过后就能绑定学生，请稍后再来。', actionLabel: '' },
  // 2026-09-26～09-29 两步实名时没录人脸视频的：普通实名已不再刷脸，重新提交一次姓名和身份证号即可完成（不重复收费）
  pending_liveness: { title: '实名认证未完成', detail: '请重新提交一次姓名和身份证号完成实名认证，之后就能绑定学生。', actionLabel: '继续认证' },
  rejected: { title: '实名认证未通过', detail: '请核对姓名和身份证号后重新提交认证。', actionLabel: '重新认证' },
  expired: { title: '实名认证已过期', detail: '请重新完成实名认证后再绑定学生。', actionLabel: '重新认证' }
}
// 实名后满 22 周岁才判定为家长（2026-09-25 用户规则）；年龄只有提交绑定码时后端才判断
const ageGateCopy = {
  guardian_underage: { title: '暂不能绑定学生', detail: '实名认证显示你未满 22 周岁，年满 22 周岁的家长才能绑定学生。如果你是学生，可以把账号切换回学生身份。', actionLabel: '去切换身份', action: 'identity' },
  guardian_age_unknown: { title: '请重新实名认证', detail: '实名信息里没有出生日期，重新提交一次实名认证后就能绑定学生。', actionLabel: '重新认证' }
}

// 服务商（2026-10-11 用户规则）：后台按用户 ID 开通，不查实名、不看年龄，能绑多少孩子按后台设的上限（绑定码绑的 + 建的网页端孩子合计）。
// 是不是服务商只有后端知道：「孩子的网页端账号」列表接口会带上 provider = { limit, used }。读不到就按普通家长处理，不挡着。
async function loadProvider() {
  try {
    const result = await loadWebChildren()
    return result && result.provider ? { limit: Number(result.provider.limit) || 0, used: Number(result.provider.used) || 0 } : null
  } catch (error) {
    return null
  }
}

function gateFor(verification) {
  const status = verification && verification.verification_status || 'not_started'
  if (status === 'verified') return null
  return gateCopy[status] || gateCopy.not_started
}

Page({
  data: {
    code: '',
    submitting: false,
    // 第一次读到实名状态前画骨架；读到后未认证显示 gate，已认证显示绑定表单
    verificationLoaded: false,
    verificationFailed: false,
    gate: null,
    provider: null
  },

  onShow() { return this.loadVerification() },

  async loadVerification() {
    const requestId = this._requestId = (this._requestId || 0) + 1
    this.setData({ verificationFailed: false })
    try {
      const [result, provider] = await Promise.all([loadCurrentIdentityVerification(), loadProvider()])
      if (requestId !== this._requestId) return
      this.setData({ verificationLoaded: true, provider, gate: provider ? null : gateFor(result.verification) })
    } catch (error) {
      if (requestId !== this._requestId) return
      // 读到过就保留旧状态，只在第一次读失败时显示重试
      if (!this.data.verificationLoaded) this.setData({ verificationFailed: true })
      wx.showToast({ title: error.message || '实名认证状态读取失败', icon: 'none' })
    }
  },

  openVerification() {
    const gate = this.data.gate
    if (gate && gate.action === 'identity') return wx.navigateTo({ url: '/account/login-identities/index' })
    wx.navigateTo({ url: '/account/login-identities/index?verify=1' })
  },

  openWebChild() {
    wx.navigateTo({ url: '/account/web-child/index' })
  },

  onCodeInput(event) {
    const code = String(event.detail.value || '').replace(/\D/g, '').slice(0, 8)
    this.setData({ code })
  },

  async submit() {
    if (this.data.submitting || !this.data.verificationLoaded || this.data.gate) return
    if (this.data.code.length !== 8) {
      wx.showToast({ title: '请输入 8 位数字绑定码', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    try {
      await bindCurrentGuardianToStudent(this.data.code)
      wx.showToast({ title: '学生绑定成功', icon: 'success' })
      if (this.data.provider) this.setData({ 'provider.used': this.data.provider.used + 1 })
      setTimeout(() => wx.navigateBack(), 700)
    } catch (error) {
      // 认证在别处失效（过期、被撤销）：切回实名认证提示
      if (error && error.status === 'guardian_verification_required') this.setData({ gate: gateCopy.not_started, provider: null })
      if (error && ageGateCopy[error.status]) this.setData({ gate: ageGateCopy[error.status] })
      wx.showToast({ title: error.message || '绑定学生失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  }
})
