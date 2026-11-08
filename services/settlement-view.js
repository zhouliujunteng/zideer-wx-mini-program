// 结算中心、结算明细、我的推广三页的展示计算（2026-09-21）。
// 界面取自 UI 设计仓库 JiahaoTang-Alvin/zhilu-miniprogram 提交 b5dda68 的
// package-promotion/pages/{settlement,settlement-records,my-promotion}。
//
// 口径（全部用动作流「读取当前推广与金币中心」返回的真实账本，设计稿的 mock 不适用）：
// - 奖励流水 promotion_reward_ledger 的 status 按产品规格分五类：
//   待解锁 locked/created/frozen、可选择 selectable/available、
//   已转现金 elected_cash/cash_available/withdrawing/paid、已转积分 elected_credits/gift_credits_available、
//   已追回 reversed/recovered。累计奖励只合计未被追回的流水。
// - 奖励追偿 reward_recovery 作为负向明细单独展示，不删减原奖励流水（与 P2D-06 第 9 章一致）。
// - 提现 / 兑换积分（2026-09-26）走 AF49 推广结算中心，申请记在 promotion_settlement，见 settlement-apply-view.js。

// 2026-09-26 提现上线后：cash_available 是「提现被驳回退回来的现金」，还能再提现，归可选择；
// 已过锁定期但还没被结算流程惰性解锁的 locked，也按可选择展示（见 rewardBucketOf）。
const STATUS_BUCKETS = {
  locked: ['locked', 'created', 'frozen', 'frozen_for_dispute', 'pending'],
  selectable: ['selectable', 'available', 'cash_available'],
  cash: ['elected_cash', 'withdrawing', 'paid', 'settled'],
  credits: ['elected_credits', 'gift_credits_available'],
  reversed: ['reversed', 'recovered', 'revoked']
}
const BUCKET_LABELS = {
  locked: '待解锁',
  selectable: '可选择',
  cash: '已转现金',
  credits: '已转积分',
  reversed: '已追回',
  other: '处理中'
}
const STAGE_LABELS = { primary: '小学', junior: '初中', senior: '高中', kindergarten: '学前' }
const DAY_MS = 24 * 60 * 60 * 1000

function toAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

function formatAmount(value) {
  return toAmount(value).toFixed(2)
}

function signedAmount(value) {
  const amount = toAmount(value)
  return `${amount < 0 ? '-' : '+'}${Math.abs(amount).toFixed(2)}`
}

function parseTime(value) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : 0
}

function pad(value) {
  return String(value).padStart(2, '0')
}

function formatMinute(value) {
  const time = parseTime(value)
  if (!time) return '时间待确认'
  const date = new Date(time)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatDay(value) {
  const time = parseTime(value)
  if (!time) return '日期待确认'
  const date = new Date(time)
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`
}

function monthLabel(value) {
  const time = parseTime(value)
  if (!time) return '其他时间'
  const date = new Date(time)
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月`
}

// 本地自然日的起点，用于「今日 / 昨日奖励」。
function dayStart(time) {
  const date = new Date(time)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function rewardBucket(status) {
  const value = String(status || '').toLowerCase()
  for (const bucket of Object.keys(STATUS_BUCKETS)) {
    if (STATUS_BUCKETS[bucket].includes(value)) return bucket
  }
  return 'other'
}

// 按整条奖励分类：锁定期已满的 locked 当作可选择（结算流程读到时才真正改状态）。
function rewardBucketOf(reward, now = Date.now()) {
  const status = String(reward && reward.status || '').toLowerCase()
  if (status === 'locked') {
    const until = reward && reward.locked_until ? new Date(reward.locked_until).getTime() : NaN
    if (Number.isFinite(until) && until <= now) return 'selectable'
  }
  return rewardBucket(status)
}

function bucketLabel(bucket) {
  return BUCKET_LABELS[bucket] || BUCKET_LABELS.other
}

function stageLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return '学习档案'
  return STAGE_LABELS[raw.toLowerCase()] || raw
}

// 奖励卡：累计奖励 + 今日 / 昨日奖励 + 可选择奖励与三项分类金额。
function buildSettlementSummary(rewards, now = Date.now()) {
  const totals = { locked: 0, selectable: 0, cash: 0, credits: 0, reversed: 0, other: 0 }
  const today = dayStart(now)
  const yesterday = today - DAY_MS
  let todayAmount = 0
  let yesterdayAmount = 0
  let total = 0

  for (const reward of Array.isArray(rewards) ? rewards : []) {
    const bucket = rewardBucketOf(reward, now)
    const amount = toAmount(reward && reward.amount)
    totals[bucket] += amount
    if (bucket === 'reversed') continue
    total += amount
    const occurredAt = parseTime(reward && (reward.occurred_at || reward.available_at))
    if (occurredAt >= today) todayAmount += amount
    else if (occurredAt >= yesterday) yesterdayAmount += amount
  }

  return {
    balanceLabel: '累计奖励（元）',
    balanceValue: formatAmount(total),
    dailySummary: [
      { id: 'today', label: '今日奖励', value: `¥${formatAmount(todayAmount)}` },
      { id: 'yesterday', label: '昨日奖励', value: `¥${formatAmount(yesterdayAmount)}` }
    ],
    selectable: {
      label: '可选择奖励（元）',
      value: formatAmount(totals.selectable),
      metrics: [
        { id: 'locked', label: '待解锁（元）', value: formatAmount(totals.locked) },
        { id: 'cash', label: '已转现金（元）', value: formatAmount(totals.cash) },
        { id: 'credits', label: '已转积分（元）', value: formatAmount(totals.credits) }
      ],
      actionLabel: '整笔转现金'
    }
  }
}

// 可赠送积分账户：没有账户时不显示这一行，不伪造 0。
function buildGiftAccount(giftAccount) {
  if (!giftAccount) return { visible: false, label: '', value: '', hint: '' }
  return {
    visible: true,
    label: '可赠送积分',
    value: formatAmount(giftAccount.available_credits),
    hint: `已赠送 ${formatAmount(giftAccount.gifted_credits)} · 已追回 ${formatAmount(giftAccount.reversed_credits)}`
  }
}

// 奖励流水 + 奖励追偿 → 一条时间线；追偿是负向金额，原奖励流水保持不动。
function buildRecords(rewards, recoveries, now = Date.now()) {
  const records = []
  for (const reward of Array.isArray(rewards) ? rewards : []) {
    const bucket = rewardBucketOf(reward, now)
    const occurredAt = reward && (reward.occurred_at || reward.available_at || reward.locked_until) || ''
    records.push({
      id: `reward-${reward && reward.id}`,
      kind: 'reward',
      statusKey: bucket,
      statusLabel: bucketLabel(bucket),
      title: '发放推广金',
      recordNo: String(reward && reward.entry_no || ''),
      monthLabel: monthLabel(occurredAt),
      detail: formatMinute(occurredAt),
      amount: signedAmount(reward && reward.amount),
      sortAt: parseTime(occurredAt)
    })
  }
  for (const recovery of Array.isArray(recoveries) ? recoveries : []) {
    const occurredAt = recovery && (recovery.created_at_business || recovery.resolved_at) || ''
    const amount = toAmount(recovery && recovery.source_amount)
    records.push({
      id: `recovery-${recovery && recovery.id}`,
      kind: 'recovery',
      statusKey: 'recovering',
      statusLabel: '追回',
      title: '奖励追回',
      recordNo: String(recovery && recovery.recovery_no || ''),
      monthLabel: monthLabel(occurredAt),
      detail: formatMinute(occurredAt),
      amount: signedAmount(-Math.abs(amount)),
      sortAt: parseTime(occurredAt)
    })
  }
  return records.sort((left, right) => right.sortAt - left.sortAt)
}

const TAB_BUCKETS = {
  pending: ['locked', 'selectable', 'other'],
  settled: ['cash', 'credits', 'reversed', 'recovering']
}

function filterRecords(records, tabId) {
  const list = Array.isArray(records) ? records : []
  if (!tabId || tabId === 'all') return list
  const buckets = TAB_BUCKETS[tabId] || []
  return list.filter((record) => buckets.includes(record.statusKey))
}

function groupRecordsByMonth(records) {
  const groups = []
  const index = {}
  for (const record of Array.isArray(records) ? records : []) {
    const key = record.monthLabel || '其他时间'
    if (!index[key]) {
      index[key] = { monthLabel: key, records: [] }
      groups.push(index[key])
    }
    index[key].records.push(record)
  }
  return groups
}

function buildRules() {
  return {
    title: '奖励规则',
    items: [
      '奖励金额按订单成交时固化的推广奖励规则快照生成，锁定期为支付后 7 天。',
      '锁定期结束后整笔二选一：提现到银行卡（需开通推广伙伴）或兑换课程积分，选择后不可拆分、不可改选。',
      '退款或纠纷按奖励追偿记录单独入账，原奖励流水与选择记录都不会被删除。'
    ]
  }
}

// 我的推广：已邀请人数与会员人数都来自服务端归因摘要（脱敏，不含学生档案 id）。
function buildInviteSummary(clients) {
  const list = Array.isArray(clients) ? clients : []
  const members = list.filter((client) => Boolean(client && client.membershipActive))
  return {
    invitedValue: String(list.length),
    memberValue: String(members.length),
    note: `已有 ${members.length} 人加入课程会员`
  }
}

function buildInviteRecords(clients) {
  return (Array.isArray(clients) ? clients : []).map((client) => {
    const active = Boolean(client && client.membershipActive)
    return {
      id: String(client && client.id),
      name: String(client && client.displayName || '学习用户'),
      avatarUrl: /^https:\/\//.test(String(client && client.avatarUrl || '')) ? String(client.avatarUrl) : '',
      stageLabel: stageLabel(client && client.stageLabel),
      attributedLabel: `绑定日期 ${formatDay(client && client.attributed_at)}`,
      sourceLabel: String(client && client.sourceLabel || '推广绑定'),
      statusLabel: String(client && client.statusLabel || ''),
      membershipActive: active,
      membershipKey: active ? 'member' : 'non-member'
    }
  })
}

function filterInviteRecords(records, tabId) {
  const list = Array.isArray(records) ? records : []
  return list.filter((record) => record.membershipKey === tabId)
}

module.exports = {
  formatAmount,
  formatDay,
  formatMinute,
  signedAmount,
  rewardBucket,
  rewardBucketOf,
  bucketLabel,
  stageLabel,
  buildSettlementSummary,
  buildGiftAccount,
  buildRecords,
  filterRecords,
  groupRecordsByMonth,
  buildRules,
  buildInviteSummary,
  buildInviteRecords,
  filterInviteRecords
}
