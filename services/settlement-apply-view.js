// 奖励结算（整笔转现金 / 兑换积分）与「我的结算记录」两页的展示计算（2026-09-26）。
// 数据来自 Zion「AF49 推广结算中心」：金额、税额、比例都是服务端算好的，这里只负责换成中文文案与展示结构。

const SUBJECT_LABELS = { individual: '个人', individual_business: '个体工商户', company: '公司' }
const STATUS_LABELS = { submitted: '待处理', processing: '处理中', paid: '已打款', rejected: '已驳回', completed: '已完成' }
const STATUS_TONES = { submitted: 'pending', processing: 'pending', paid: 'done', rejected: 'rejected', completed: 'done' }
const PENDING_STATUSES = ['submitted', 'processing']

function toNumber(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function yuan(value) {
  return toNumber(value).toFixed(2)
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatMinute(value) {
  const time = value ? new Date(value).getTime() : NaN
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDay(value) {
  const time = value ? new Date(value).getTime() : NaN
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

// 积分：整数就不带小数，否则保留两位。
function creditsText(value) {
  const n = toNumber(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

function subjectLabel(value) {
  return SUBJECT_LABELS[value] || '—'
}

// 顶部金额卡：可结算（含驳回退回的现金）、锁定中、提现中。
function buildHero(overview) {
  const amounts = overview && overview.amounts || {}
  return {
    label: '可结算奖励（元）',
    value: yuan(toNumber(amounts.available) + toNumber(amounts.cash_only)),
    metrics: [
      { id: 'locked', label: '锁定中（元）', value: yuan(amounts.locked) },
      { id: 'withdrawing', label: '提现中（元）', value: yuan(amounts.withdrawing) },
      { id: 'paid', label: '已提现（元）', value: yuan(amounts.paid) }
    ],
    lockHint: amounts.next_unlock_at ? `锁定期 7 天，最近一笔 ${formatDay(amounts.next_unlock_at)} 解锁` : '锁定期 7 天，7 天之后可提现'
  }
}

// 进页面默认选哪一栏：开通了推广伙伴选提现，否则选兑换积分。
function defaultTab(overview) {
  return overview && overview.promoter && overview.promoter.active ? 'cash' : 'credits'
}

const CASH_NOTICES = {
  not_promoter: { title: '提现需开通推广伙伴', copy: '申请成为推广伙伴：核验身份证后提交申请，平台审核开通；签署《劳务费代扣代发协议》后即可提现。现在也可以把奖励兑换成课程积分。', actionLabel: '申请成为推广伙伴', action: 'open_partner' },
  promoter_suspended: { title: '推广伙伴资格已暂停', copy: '暂不能提交提现，历史记录仍可在「我的结算记录」查看；如有疑问请联系客服。', actionLabel: '联系客服' },
  profile_missing: { title: '签约资料待填写', copy: '客服会发你一个签约资料填写链接：用小程序 ID 和身份证号后 6 位核验后，填写签约主体与收款信息，平台复核通过即可提现。', actionLabel: '联系客服获取链接' },
  profile_pending: { title: '签约资料复核中', copy: '你提交的签约资料正在复核，一般 1～2 个工作日完成，通过后即可提现。', actionLabel: '联系客服' },
  profile_rejected: { title: '签约资料未通过复核', copy: '请按客服发的链接修改后重新提交。', actionLabel: '联系客服' },
  profile_disabled: { title: '结算资料已停用', copy: '请联系客服确认结算资料后再提现。', actionLabel: '联系客服' },
  agreement_missing: { title: '劳务协议待上传', copy: '平台上传你签署的《劳务费代扣代发协议》后即可提现。', actionLabel: '联系客服' }
}

// 签约资料被退回时把原因写进提示（原因由后台复核时填写）
function cashNotice(state, note) {
  const base = CASH_NOTICES[state] || CASH_NOTICES.not_promoter
  if (state !== 'profile_rejected' || !note) return { ...base }
  return { ...base, copy: `原因：${note}。${base.copy}` }
}

function taxRows(tax) {
  if (!tax) return []
  if (tax.rule === 'invoice') {
    return [
      { id: 'income', label: '提现金额', value: `¥${yuan(tax.income)}` },
      { id: 'tax', label: '代扣个税', value: '不代扣', note: '凭发票结算，税费由开票方自行申报' }
    ]
  }
  const rate = Math.round(toNumber(tax.rate) * 100)
  const quick = toNumber(tax.quick_deduction)
  return [
    { id: 'income', label: '提现金额', value: `¥${yuan(tax.income)}` },
    { id: 'deduction', label: '减除费用', value: `-¥${yuan(tax.deduction)}`, note: tax.deduction_kind === 'ratio_20' ? '收入超过 4000 元减除 20%' : '收入 4000 元以内减除 800 元' },
    { id: 'taxable', label: '应纳税所得额', value: `¥${yuan(tax.taxable)}` },
    { id: 'tax', label: '预扣个税', value: `-¥${yuan(tax.tax)}`, note: quick > 0 ? `预扣率 ${rate}%，速算扣除 ${yuan(quick)} 元` : `预扣率 ${rate}%` }
  ]
}

function buildCashView(overview) {
  const cash = overview && overview.cash || {}
  const state = String(cash.state || 'not_promoter')
  const ready = state === 'ready'
  const bank = cash.bank || null
  const agreement = cash.agreement || null
  const pending = overview && overview.pending || {}
  return {
    state,
    ready,
    notice: ready ? null : cashNotice(state, cash.review_note),
    amount: toNumber(cash.amount),
    amountText: yuan(cash.amount),
    subjectLabel: subjectLabel(cash.subject_type),
    legalName: String(cash.legal_name || ''),
    bankTail: bank && bank.account_no_masked ? String(bank.account_no_masked).slice(-4) : '',
    bankRows: bank ? [
      { id: 'subject', label: '签约主体', value: `${subjectLabel(cash.subject_type)}${cash.legal_name ? ' · ' + cash.legal_name : ''}` },
      { id: 'account', label: '收款户名', value: bank.account_name || '—' },
      { id: 'bank', label: '开户银行', value: [bank.bank_name, bank.branch].filter(Boolean).join(' ') || '—' },
      { id: 'no', label: '银行卡号', value: bank.account_no_masked || '—' }
    ] : [],
    taxRows: taxRows(cash.tax),
    netText: cash.tax ? yuan(cash.tax.net) : yuan(cash.amount),
    taxNote: cash.tax && cash.tax.rule === 'invoice'
      ? '个体工商户、公司凭发票结算，税费由开票方自行申报。以上为预估，实际到账以平台核算为准。'
      : '按劳务报酬所得预扣预缴估算，平台代扣代缴个税。以上为预估，实际扣税与到账金额以平台核算为准。',
    invoiceRequired: Boolean(cash.invoice_required),
    invoiceHint: cash.invoice_required ? '请上传与提现金额一致的发票（图片或 PDF，最多 9 个）' : '个人提现可不上传；有发票可一并上传（图片或 PDF，最多 9 个）',
    agreement: agreement ? {
      title: '《劳务费代扣代发协议》',
      meta: [agreement.no ? `协议编号 ${agreement.no}` : '', agreement.signed_at ? `${formatDay(agreement.signed_at)} 签署` : ''].filter(Boolean).join(' · '),
      url: String(agreement.file_url || ''),
      fileType: String(agreement.file_type || 'pdf').toLowerCase(),
      fileName: String(agreement.file_name || '劳务费代扣代发协议.pdf')
    } : null,
    pendingCount: toNumber(pending.count),
    pendingText: toNumber(pending.count) > 0 ? `你有 ${toNumber(pending.count)} 笔提现正在处理，可在「我的结算记录」查看进度` : ''
  }
}

function buildCreditsView(overview) {
  const credits = overview && overview.credits || {}
  const amounts = overview && overview.amounts || {}
  const state = String(credits.state || 'disabled')
  const cashOnly = toNumber(amounts.cash_only)
  return {
    state,
    ready: state === 'ready',
    notice: state === 'ready' ? null : state === 'no_profile'
      ? { title: '请先完善学习档案', copy: '积分记在你的学习档案里，完善后即可兑换。' }
      : { title: '兑换积分暂未开放', copy: '平台开放后即可把推广奖励兑换成课程积分。' },
    amount: toNumber(credits.amount),
    amountText: yuan(credits.amount),
    credits: toNumber(credits.credits),
    creditsText: creditsText(credits.credits),
    rateText: credits.rate ? `1 元 = ${creditsText(credits.rate)} 积分` : '',
    validityText: credits.valid_days ? `兑换的积分 ${credits.valid_days} 天内有效` : '兑换的积分永久有效',
    cashOnlyNote: cashOnly > 0 ? `另有 ¥${yuan(cashOnly)} 已选择提现，只能提现，不能再兑换积分。` : ''
  }
}

// 我的结算记录：一条申请一行。
function buildApplicationItems(list) {
  return (Array.isArray(list) ? list : []).map((row) => {
    const credits = row.settle_type === 'credits'
    const status = String(row.status || '')
    return {
      id: String(row.id),
      title: credits ? '兑换课程积分' : '提现到银行卡',
      requestNo: String(row.request_no || ''),
      statusKey: status,
      statusLabel: STATUS_LABELS[status] || '处理中',
      statusTone: STATUS_TONES[status] || 'pending',
      amountText: credits ? `+${creditsText(row.credits_amount)} 积分` : `¥${yuan(row.paid_amount !== null && row.paid_amount !== undefined && status === 'paid' ? row.paid_amount : row.reward_amount)}`,
      subText: credits ? `奖励 ¥${yuan(row.reward_amount)}` : (status === 'paid' ? `实发 · 奖励 ¥${yuan(row.reward_amount)}` : `奖励金额${row.invoice_count ? ` · 发票 ${row.invoice_count} 个` : ''}`),
      dateText: formatMinute(row.submitted_at || row.completed_at)
    }
  })
}

const APPLICATION_TABS = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '处理中' },
  { id: 'done', label: '已完成' }
]

function filterApplications(items, tabId) {
  const list = Array.isArray(items) ? items : []
  if (tabId === 'pending') return list.filter((item) => PENDING_STATUSES.includes(item.statusKey))
  if (tabId === 'done') return list.filter((item) => !PENDING_STATUSES.includes(item.statusKey))
  return list
}

function isImageFormat(format) {
  return ['jpg', 'jpeg', 'png', 'webp'].includes(String(format || '').toLowerCase())
}

// 结算详情：状态卡、进度、金额明细、收款信息、发票与支付凭证。
function buildApplicationDetail(detail) {
  const row = detail || {}
  const credits = row.settle_type === 'credits'
  const status = String(row.status || '')
  const tax = row.tax_snapshot || null
  const exchange = row.exchange_snapshot || null
  const files = Array.isArray(row.files) ? row.files : []
  const fileView = (file) => ({
    id: String(file.id),
    name: String(file.name || '附件'),
    format: String(file.format || '').toLowerCase(),
    isImage: isImageFormat(file.format),
    url: String(file.url || ''),
    dateText: formatMinute(file.uploaded_at)
  })
  const amountRows = credits ? [
    { id: 'reward', label: '兑换奖励', value: `¥${yuan(row.reward_amount)}` },
    { id: 'rate', label: '兑换比例', value: exchange && exchange.credits_per_yuan ? `1 元 = ${creditsText(exchange.credits_per_yuan)} 积分` : '—' },
    { id: 'credits', label: '到账积分', value: `${creditsText(row.credits_amount)} 积分`, strong: true },
    { id: 'validity', label: '积分有效期', value: exchange && exchange.expires_at ? `${formatDay(exchange.expires_at)} 到期` : '永久有效' }
  ] : [
    { id: 'reward', label: '提现奖励', value: `¥${yuan(row.reward_amount)}` },
    { id: 'estimatedTax', label: '预估扣税', value: row.estimated_tax === null || row.estimated_tax === undefined ? '—' : (tax && tax.rule === 'invoice' ? '不代扣' : `¥${yuan(row.estimated_tax)}`) },
    { id: 'estimatedNet', label: '预估到账', value: row.estimated_net === null || row.estimated_net === undefined ? '—' : `¥${yuan(row.estimated_net)}` }
  ]
  const settledRows = !credits && status === 'paid' ? [
    { id: 'settled', label: '核定佣金', value: `¥${yuan(row.settled_amount)}` },
    { id: 'tax', label: '代扣税费', value: `¥${yuan(row.tax_amount)}` },
    { id: 'paid', label: '实发金额', value: `¥${yuan(row.paid_amount)}`, strong: true }
  ] : []
  const steps = credits ? [
    { id: 'submitted', label: '提交兑换', time: formatMinute(row.submitted_at), state: 'done' },
    { id: 'completed', label: '积分到账', time: formatMinute(row.completed_at), state: 'done' }
  ] : [
    { id: 'submitted', label: '提交申请', time: formatMinute(row.submitted_at), state: 'done' },
    { id: 'processing', label: '平台处理', time: formatMinute(row.processing_at), state: status === 'submitted' ? 'current' : 'done' },
    status === 'rejected'
      ? { id: 'rejected', label: '已驳回', time: formatMinute(row.completed_at), state: 'rejected' }
      : { id: 'paid', label: '已打款', time: formatMinute(row.completed_at), state: status === 'paid' ? 'done' : 'todo' }
  ]
  return {
    id: String(row.id || ''),
    credits,
    title: credits ? '兑换课程积分' : '提现到银行卡',
    statusKey: status,
    statusLabel: STATUS_LABELS[status] || '处理中',
    statusTone: STATUS_TONES[status] || 'pending',
    heroLabel: credits ? '到账积分' : (status === 'paid' ? '实发金额（元）' : '提现奖励（元）'),
    heroValue: credits ? creditsText(row.credits_amount) : yuan(status === 'paid' ? row.paid_amount : row.reward_amount),
    requestNo: String(row.request_no || ''),
    submittedText: formatMinute(row.submitted_at),
    steps,
    amountRows,
    settledRows,
    processNote: String(row.process_note || ''),
    rejectReason: String(row.reject_reason || ''),
    bankRows: !credits && row.bank ? [
      { id: 'subject', label: '签约主体', value: `${subjectLabel(row.subject_type)}${row.legal_name ? ' · ' + row.legal_name : ''}` },
      { id: 'account', label: '收款户名', value: row.bank.account_name || '—' },
      { id: 'bank', label: '开户银行', value: [row.bank.bank_name, row.bank.branch].filter(Boolean).join(' ') || '—' },
      { id: 'no', label: '银行卡号', value: row.bank.account_no_masked || '—' }
    ] : [],
    invoices: files.filter((file) => file.kind === 'invoice').map(fileView),
    proofs: files.filter((file) => file.kind === 'payment_proof').map(fileView)
  }
}

module.exports = {
  SUBJECT_LABELS,
  STATUS_LABELS,
  APPLICATION_TABS,
  yuan,
  creditsText,
  subjectLabel,
  isImageFormat,
  buildHero,
  defaultTab,
  buildCashView,
  buildCreditsView,
  buildApplicationItems,
  filterApplications,
  buildApplicationDetail
}
