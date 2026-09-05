const { loadCurrentLoginIdentities } = require('../../services/identity')

const channelLabels = {
  wechat_miniapp: '微信小程序',
  wechat: '微信',
  phone: '手机号',
  web: '网页登录'
}

const roleLabels = {
  USER: '学习用户',
  GUARDIAN: '家长',
  PROMOTER: '推广伙伴',
  TEACHER: '教师'
}

function formatDate(value) {
  if (!value) return '暂未记录'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '暂未记录'
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function buildPageData(principal) {
  if (!principal) return null
  const verification = principal.guardian_verification || null
  const status = verification && verification.verification_status || 'not_started'
  const verificationLabels = {
    verified: '已实名核验',
    pending: '实名认证审核中',
    rejected: '实名认证未通过',
    expired: '实名认证已过期',
    not_started: '尚未完成实名认证'
  }
  return {
    principalNo: principal.principal_no || '业务账号待初始化',
    principalStatus: principal.status || 'active',
    createdSource: principal.created_source || '当前登录来源',
    identities: (principal.account_identities || []).map((item) => ({
      ...item,
      channelLabel: channelLabels[item.login_channel] || '已绑定登录方式',
      verificationLabel: item.verified_at ? `已验证 · ${formatDate(item.verified_at)}` : '待验证',
      loginLabel: item.last_login_at ? `最近登录 ${formatDate(item.last_login_at)}` : '暂未记录登录时间',
      statusLabel: item.disabled_at ? '已停用' : (item.is_default ? '当前默认' : '可用')
    })),
    roles: (principal.role_assignments || []).map((item) => ({
      ...item,
      label: roleLabels[item.role_code] || item.role_code || '业务角色'
    })),
    verification: {
      label: verificationLabels[status] || '实名认证状态待确认',
      detail: verification && verification.verified_at ? `核验时间 ${formatDate(verification.verified_at)}` : '家长绑定和涉及现金结算的功能会在实名认证完成后开放。',
      status
    }
  }
}

Page({
  data: { loading: true, failed: false, account: null },

  onShow() { this.loadPage() },

  async onPullDownRefresh() {
    await this.loadPage()
    wx.stopPullDownRefresh()
  },

  async loadPage() {
    this.setData({ loading: true, failed: false })
    try {
      this.setData({ account: buildPageData(await loadCurrentLoginIdentities()) })
    } catch (error) {
      this.setData({ failed: true })
      wx.showToast({ title: error.message || '登录身份加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  }
})
