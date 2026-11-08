const config = require('../config/index')
const { invokeActionFlow, parseActionFlowResult, uploadPrivateFile } = require('./identity')

// 推广结算（2026-09-26）：调 Zion「AF49 推广结算中心」。
// - overview  奖励结算页要的数据（可结算金额、提现资格、收款信息、个税预估、劳务协议、兑换比例）
// - withdraw  整笔提现（已开通推广伙伴、后台录好结算资料与劳务协议），带发票
// - exchange  整笔兑换课程积分（没开通推广伙伴也能用）
// - list / detail  我的结算记录
// - application / apply  申请成为推广伙伴（2026-09-29）：读申请页状态、提交申请（要已实名；不刷脸）
// 金额、比例、税额都由服务端算，这里只传选择与发票文件 id。

const MESSAGES = {
  unauthenticated: '请先登录后再操作。',
  not_initialized: '请先完善学习档案。',
  invalid: '请求无效，请刷新后重试。',
  not_found: '没有找到这条结算记录。',
  not_promoter: '提现需先开通推广伙伴，请联系客服开通。',
  promoter_suspended: '推广伙伴资格已暂停，暂不能提现。',
  profile_missing: '结算资料还没录入，请联系客服。',
  profile_disabled: '结算资料已停用，请联系客服。',
  agreement_missing: '劳务协议还没上传，请联系客服。',
  agreement_required: '请先阅读并同意《劳务费代扣代发协议》。',
  invoice_required: '请先上传发票。',
  no_amount: '暂无可结算的奖励。',
  exchange_disabled: '兑换积分暂未开放。',
  no_profile: '请先完善学习档案。',
  account_unavailable: '积分账户暂不可用，请联系客服。',
  already_promoter: '你已经是推广伙伴了。',
  invalid_phone: '请输入正确的 11 位手机号。',
  verification_required: '请先完成基础核验（姓名和身份证号）。',
  already_submitted: '申请已提交，正在审核。'
}

function settlementFlow() {
  const flow = config.ACTION_FLOWS.PROMOTION_SETTLEMENT_CENTER
  // 编号由 Zion 部署脚本上线后写入 config；还是占位就是还没开放。
  if (!flow || !/^[0-9a-f-]{36}$/i.test(String(flow.id || ''))) throw new Error('结算功能暂未开放，请稍后再试。')
  return flow
}

async function callSettlement(payload) {
  return parseActionFlowResult(await invokeActionFlow(settlementFlow(), { payload }, { timeout: 20000 })) || {}
}

function failWith(status, fallback) {
  throw Object.assign(new Error(MESSAGES[status] || fallback), { code: status || 'failed' })
}

function createSettlementKey(prefix) {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `${prefix}-${timestamp}-${random}`
}

async function loadSettlementCenter() {
  const result = await callSettlement({ operation: 'overview' })
  if (result.status !== 'ready') failWith(result.status, '奖励结算暂时无法读取，请稍后重试。')
  return result
}

// invoices：[{ fileId, name, format }]（先用 uploadSettlementInvoice 传好）。
async function submitSettlementWithdrawal({ invoices = [], idempotencyKey } = {}) {
  const result = await callSettlement({
    operation: 'withdraw',
    agree: true,
    idempotency_key: String(idempotencyKey || createSettlementKey('settle-cash')),
    invoices: (Array.isArray(invoices) ? invoices : []).map((file) => ({
      file_id: Number(file.fileId), name: String(file.name || ''), format: String(file.format || '')
    }))
  })
  if (result.status !== 'submitted') failWith(result.status, '提现申请提交失败，请稍后重试。')
  return result
}

async function exchangeSettlementCredits({ idempotencyKey } = {}) {
  const result = await callSettlement({
    operation: 'exchange',
    idempotency_key: String(idempotencyKey || createSettlementKey('settle-credit'))
  })
  if (result.status !== 'completed') failWith(result.status, '兑换积分失败，请稍后重试。')
  return result
}

async function loadSettlementApplications() {
  const result = await callSettlement({ operation: 'list' })
  if (result.status !== 'ready') failWith(result.status, '结算记录暂时无法读取，请稍后重试。')
  return Array.isArray(result.settlements) ? result.settlements : []
}

async function loadSettlementApplication(id) {
  const settlementId = Number(id)
  if (!Number.isSafeInteger(settlementId) || settlementId <= 0) failWith('not_found')
  const result = await callSettlement({ operation: 'detail', id: settlementId })
  if (result.status !== 'ready') failWith(result.status, '结算详情暂时无法读取，请稍后重试。')
  return result.settlement || null
}

// 申请成为推广伙伴页的状态：{ promoter, verification, application }
async function loadPartnerApplication() {
  const result = await callSettlement({ operation: 'application' })
  if (result.status !== 'ready') failWith(result.status, '申请状态暂时无法读取，请稍后重试。')
  return result
}

// 提交申请：姓名、身份证都由服务端取，这里只传联系手机号和申请说明
async function submitPartnerApplication({ contactPhone, note } = {}) {
  const result = await callSettlement({
    operation: 'apply',
    contact_phone: String(contactPhone || '').replace(/\s+/g, ''),
    note: String(note || '').trim()
  })
  if (result.status !== 'submitted') failWith(result.status, '申请提交失败，请稍后重试。')
  return result.application || null
}

// 发票：PDF 或图片，单个不超过 10MB，存私有。
function uploadSettlementInvoice({ path, name }) {
  return uploadPrivateFile(path, { name })
}

module.exports = {
  MESSAGES,
  createSettlementKey,
  loadSettlementCenter,
  submitSettlementWithdrawal,
  exchangeSettlementCredits,
  loadSettlementApplications,
  loadSettlementApplication,
  uploadSettlementInvoice,
  loadPartnerApplication,
  submitPartnerApplication
}
