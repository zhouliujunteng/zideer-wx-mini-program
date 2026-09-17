function dateText(value) {
  const date = new Date(value)
  if (!value || !Number.isFinite(date.getTime())) return ''
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function creditsText(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(Math.round(n)) : '0'
}

// Presentation only. Course access and member pricing remain checked by the server.
function membershipView(membership, now = Date.now()) {
  if (!membership) return { active: false, permanent: false, tierLabel: '等级待确认', statusLabel: '正在读取会员信息', validityText: '', expiresText: '', remainingText: '', giftCreditsText: '', libraryLabel: '待确认' }
  const tier = membership.tier || null
  const expires = Date.parse(membership.expiresAt)
  const permanent = membership.permanent === true
  const active = membership.eligible === true && membership.status === 'active' && !!tier
    && (permanent ? !membership.expiresAt : Number.isFinite(expires) && expires > now)
  const labels = { inactive: '尚未开通会员', pending: '订单待支付', expired: '会员已到期', refunded: '退款处理中或已退款', closed: '订单已关闭' }
  return {
    active,
    permanent: active && permanent,
    tierLabel: active ? tier.name : '普通用户',
    statusLabel: active ? '会员已开通' : labels[membership.status] || '会员状态待确认',
    validityText: active ? (permanent ? '永久有效' : `${dateText(membership.expiresAt)} 到期`) : '',
    expiresText: dateText(membership.expiresAt),
    remainingText: active && !permanent ? `剩余 ${Math.ceil((expires - now) / 86400000)} 天` : '',
    giftCreditsText: active && Number(tier.creditAmount) > 0 ? `开通赠送 ${creditsText(tier.creditAmount)} 积分` : '',
    libraryLabel: active ? (permanent ? '永久可用' : '有效期内可用') : '未开通'
  }
}

module.exports = { membershipView, dateText, creditsText }
