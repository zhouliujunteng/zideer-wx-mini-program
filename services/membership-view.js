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

// 价格展示去掉末尾多余的 0：28.80 → 28.8，298.00 → 298，9800.00 → 9800（四位数价格在等级卡片里才放得下）。
function priceText(value) {
  const n = Number(value)
  return Number.isFinite(n) ? String(Number(n.toFixed(2))) : String(value || '')
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

// 会员权益卡片：「我的会员权益」与选中等级的权益共用一套结构（2026-09-24 用户：选中哪个等级，下面就显示哪个等级的权益）。
// mode：owned 已拥有（可点进课程库、积分包）；preview 选中准备开通 / 升级的等级；none 未开通、也没有可选等级。
// 后端为某个等级配了权益清单（product_version.service_rule.benefits）时照清单显示，否则按现有的三项权益显示。
const BENEFIT_ARTS = ['/commerce/assets/membership/benefit-learning-view.svg', '/commerce/assets/membership/benefit-learning-plan.svg']

function benefitCards(tier, mode = 'none') {
  const owned = mode === 'owned'
  const custom = tier && Array.isArray(tier.benefits) ? tier.benefits.filter(item => item && typeof item.title === 'string' && item.title) : []
  if (mode !== 'none' && custom.length) {
    return custom.map((item, index) => ({ key: 'custom-' + index, title: item.title, subtitle: item.description || '', state: owned ? '已拥有' : '',
      stateActive: owned, art: BENEFIT_ARTS[index % BENEFIT_ARTS.length], action: '' }))
  }
  const credits = tier && Number(tier.creditAmount) > 0 ? creditsText(tier.creditAmount) : ''
  return [
    { key: 'library', title: '会员课程库', subtitle: '平台已上架课程', art: BENEFIT_ARTS[0],
      state: mode === 'none' ? '未开通' : owned ? '永久可用 ›' : '永久可用', stateActive: owned, action: owned ? 'openLibrary' : '' },
    { key: 'credits', title: '课程积分', subtitle: '开通赠送，永久有效，用于生成专属课程', art: BENEFIT_ARTS[1],
      state: mode === 'none' ? '按等级赠送' : credits ? `${owned ? '开通' : ''}赠送 ${credits} 积分` : '不赠送积分', stateActive: owned && !!credits, action: '' },
    { key: 'packs', title: '积分包', subtitle: '积分不够时随时补充，会员购买享会员价', art: BENEFIT_ARTS[0],
      state: owned ? '去购买 ›' : mode === 'none' ? '开通会员享会员价' : '享会员价', stateActive: owned, action: 'openProducts' }
  ]
}

module.exports = { membershipView, benefitCards, dateText, creditsText, priceText }
