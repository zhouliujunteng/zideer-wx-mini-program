const statuses = {
  active: '有效', inactive: '未启用', pending: '待处理', processing: '处理中',
  succeeded: '已完成', success: '已成功', failed: '失败', cancelled: '已取消',
  canceled: '已取消', expired: '已过期', revoked: '已撤销', exhausted: '已用完',
  redeemed: '已兑换', generated: '待启用', completed: '已完成', closed: '已关闭',
  paid: '已支付', unpaid: '待支付', refunded: '已退款', refunding: '退款中',
  approved: '已通过', rejected: '未通过', reviewing: '审核中', submitted: '已提交',
  frozen: '已冻结', released: '已退回', settled: '已结算', confirmed: '已确认',
  available: '可用', locked: '待解锁', ready: '已就绪', draft: '草稿', published: '已发布',
  paused: '已暂停', used: '已使用', scheduled: '已安排', queued: '排队中',
  pending_payment: '待支付', notpay: '待支付', userpaying: '支付处理中', payerror: '支付失败'
}
const sources = {
  redemption: '兑换码兑换', purchase: '购买获得', payment: '支付获得',
  manual: '后台发放', admin: '后台发放', admin_grant: '后台发放',
  adjustment: '后台调整', promotion: '推广赠送', promotion_reward: '推广奖励',
  registration: '注册赠送', signup: '注册赠送', reward: '奖励获得',
  membership: '会员权益', refund: '退款返还', quality_refund: '课程质量返还',
  teacher_refund: '老师审核返还', conversion: '奖励兑换', invite: '邀请加入',
  invitation: '邀请加入', share: '分享邀请', qrcode: '扫码加入', qr_code: '扫码加入',
  poster: '海报邀请', link: '链接邀请',
  assignment: '平台分配', manual_assignment: '平台分配'
}
const businesses = {
  ...sources, grant: '积分发放', freeze: '积分冻结', consume: '积分使用',
  return: '积分退回', release: '积分退回', expire: '积分到期',
  course_generation: '课程生成', course_generation_freeze: '课程生成冻结',
  course_generation_consume: '课程生成扣费', course_generation_return: '课程结算退差',
  course_generation_failure_release: '生成失败退回', course_generation_limit_release: '课程超额退回',
  course_generation_cancel_release: '课程取消退回', course_generation_cancelled_release: '课程取消退回',
  daily_checkin: '每日签到奖励', knowledge_mastery: '知识点掌握奖励',
  topic_learning_report: '学习报告奖励', withdrawal: '提现', withdrawal_return: '提现退回'
}
function label(dictionary, value, fallback) {
  const raw = String(value || '').trim()
  return dictionary[raw.toLowerCase()] || (/^[\u3400-\u9fff0-9\s、，。（）]+$/.test(raw) ? raw : fallback)
}
function statusLabel(value, context) {
  if (context === 'redemption' && value === 'succeeded') return '兑换成功'
  if (context === 'redemption' && value === 'failed') return '兑换失败'
  return label(statuses, value, '状态待确认')
}
function sourceLabel(value) { return label(sources, value, '其他来源') }
function businessLabel(value, entryType, kind = 'credit') {
  const fallback = kind === 'coin' ? '金币变动' : '课程积分变动'
  const explicit = label(businesses, value, '')
  if (explicit) return explicit
  const entry = label(businesses, entryType, fallback)
  return kind === 'coin' ? entry.replace(/积分/g, '金币') : entry
}
function sceneLabel(value) { return label(sources, value, '推广邀请') }
function diagnosisTypeLabel(value) {
  return label({ concept: '概念理解', conceptual: '概念理解', concept_error: '概念理解错误',
    calculation: '计算', calculation_error: '计算错误', careless: '疏忽失误', careless_error: '疏忽失误',
    comprehension: '理解', reading: '阅读理解', reasoning: '推理', application: '应用',
    knowledge_gap: '知识缺漏', algebra: '代数', geometry: '几何', statistics: '统计', probability: '概率' }, value, '待分类')
}
function dateTimeLabel(value) {
  if (!value) return '待确认'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '待确认'
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
module.exports = { statusLabel, sourceLabel, businessLabel, sceneLabel, dateTimeLabel, diagnosisTypeLabel }
