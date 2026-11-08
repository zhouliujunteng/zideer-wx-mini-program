// 订单记录、订单详情两页共用的展示计算（2026-09-25 按设计语言重做，设计仓库没有订单页设计稿）。
// 订单来自动作流「读取当前课程积分账户」的 orders（ud_dingdan），status 存中文：待支付 / 已支付 / 已取消 / 已退款。

const KIND_LABELS = { course_credit: '积分包', library_membership: '知鹿会员' }
// 状态标签配色取自设计稿 M34 积分明细的图例：待支付橙（要处理）、已支付绿、已退款蓝、已关闭灰。
const STATUS_TONES = { '待支付': 'pending', '已支付': 'paid', '已退款': 'refunded', '已取消': 'closed' }

const ORDER_TABS = [
  { id: 'all', label: '全部' },
  { id: '待支付', label: '待支付' },
  { id: '已支付', label: '已支付' }
]

function pad(value) {
  return String(value).padStart(2, '0')
}

function parseDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function monthLabel(value) {
  const date = parseDate(value)
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月` : ''
}

// 列表里的时间：同月分组下只写月日时分（与课程积分明细一致）
function shortTimeLabel(value) {
  const date = parseDate(value)
  return date ? `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}

function fullTimeLabel(value) {
  const date = parseDate(value)
  return date ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ''
}

function dayLabel(value) {
  const date = parseDate(value)
  return date ? `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日` : ''
}

function creditsText(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? String(Math.round(amount * 100) / 100) : ''
}

function moneyText(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount.toFixed(2) : ''
}

function kindLabel(order) {
  return KIND_LABELS[order.order_kind] || '订单'
}

function statusTone(order) {
  return STATUS_TONES[order.status] || 'closed'
}

function orderTitle(order) {
  return order.title || (order.product_version && order.product_version.display_name) || kindLabel(order)
}

function orderTabsFor(tabId) {
  return ORDER_TABS.map(tab => ({ ...tab, isSelected: tab.id === tabId }))
}

function orderRecord(order) {
  return {
    id: String(order.id),
    title: orderTitle(order),
    amount: `¥${order.amountDisplay || moneyText(order.amount) || '0.00'}`,
    detail: [kindLabel(order), order.beneficiaryName ? `受益学生 ${order.beneficiaryName}` : ''].filter(Boolean).join(' · '),
    time: shortTimeLabel(order.created_at),
    statusLabel: order.statusLabel || order.status || '',
    tone: statusTone(order)
  }
}

// 订单按下单时间倒序（后端已排好），按月分组；tabId 为 all 或订单状态。
function groupOrdersByMonth(orders, tabId) {
  const groups = []
  const indexByMonth = {}
  ;(orders || []).filter(order => tabId === 'all' || order.status === tabId).forEach((order) => {
    const key = monthLabel(order.created_at) || '更早'
    if (!(key in indexByMonth)) {
      indexByMonth[key] = { monthKey: key, monthLabel: key, records: [] }
      groups.push(indexByMonth[key])
    }
    indexByMonth[key].records.push(orderRecord(order))
  })
  return groups
}

// 订单详情：顶部概览 + 订单信息 + 积分发放 + 支付信息，底部按钮只在有事可做时出现（待支付的积分包继续支付、会员订单去会员中心）。
function orderDetailView(order) {
  const isMembership = order.order_kind === 'library_membership'
  const product = order.product_version || {}
  const credits = isMembership ? '' : creditsText(product.credit_amount)
  const rows = [
    { label: '订单编号', value: order.order_no || String(order.id), copyable: Boolean(order.order_no) },
    { label: '订单类型', value: kindLabel(order) },
    credits ? { label: '课程积分', value: credits } : null,
    { label: '受益学生', value: order.beneficiaryName || '当前学生' },
    { label: '下单时间', value: fullTimeLabel(order.created_at) || '待确认' },
    order.fulfilled_at ? { label: '支付时间', value: fullTimeLabel(order.fulfilled_at) } : null,
    order.status !== '已支付' && order.closed_at ? { label: '关闭时间', value: fullTimeLabel(order.closed_at) } : null
  ].filter(Boolean)
  const batches = (order.batches || []).map(batch => ({
    id: String(batch.id),
    title: `发放 ${creditsText(batch.original_credits)} 课程积分`,
    meta: [batch.active_at ? `${dayLabel(batch.active_at)}到账` : '', batch.expires_at ? `${dayLabel(batch.expires_at)}到期` : '长期有效'].filter(Boolean).join(' · '),
    remaining: `剩余 ${creditsText(batch.remaining_credits)}`
  }))
  const payment = order.payment ? [
    { label: '支付方式', value: '微信支付' },
    { label: '支付状态', value: order.payment.statusLabel || '待确认' },
    { label: '实付金额', value: `¥${moneyText(order.payment.grand_total_value) || order.amountDisplay}`, tone: 'price' }
  ] : []
  let action = null
  if (isMembership) action = { id: 'membership', label: '查看会员中心' }
  else if (order.status === '待支付') action = { id: 'pay', label: '继续支付' }
  return {
    title: orderTitle(order),
    amount: order.amountDisplay || moneyText(order.amount) || '0.00',
    kindLabel: kindLabel(order),
    statusLabel: order.statusLabel || order.status || '',
    tone: statusTone(order),
    icon: isMembership ? '/assets/me/membership-crown-matte.png' : '/assets/commerce/course-points-star-generated.png',
    rows,
    batches,
    payment,
    action
  }
}

module.exports = { ORDER_TABS, orderTabsFor, groupOrdersByMonth, orderRecord, orderDetailView }
