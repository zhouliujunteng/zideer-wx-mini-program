// 申请成为推广伙伴页（agent/partner-apply）的展示逻辑，纯函数、不调接口。
// 两步：1 基础核验（填身份证姓名、身份证号，就是实名认证；已实名的直接算完成）→ 2 提交申请，后台审核通过即开通。
// 2026-10-13 用户规则：人脸识别流程整个不要了（09-29～10-12 曾在申请前 / 开通后「完善信息」刷脸）。
// 后端（AF49 application）给：promoter（是否已开通）、verification（是否已实名）、application（最近一次申请）。

const STEP_TITLES = [
  { id: 'basic', title: '基础核验', copy: '身份证姓名和号码' },
  { id: 'submit', title: '提交申请', copy: '平台审核后开通' }
]

function promoterActive(data) {
  const promoter = data && data.promoter
  return Boolean(promoter && promoter.active)
}

// 申请页整体处于哪种状态：
// - active     已是推广伙伴
// - suspended  推广伙伴资格被停用（由客服在后台恢复，不走申请）
// - submitted  申请已提交，等待审核
// - form       可以申请（没申请过，或上次没通过）
function applyState(data) {
  if (promoterActive(data)) return 'active'
  const promoter = data && data.promoter
  if (promoter && promoter.status === 'suspended') return 'suspended'
  const application = data && data.application
  if (application && application.status === 'submitted') return 'submitted'
  return 'form'
}

// 申请当前在第几步：已实名就到第 2 步（提交申请），否则第 1 步。
function currentStep(data) {
  return data && data.verification && data.verification.verified ? 2 : 1
}

function stepsOf(titles, step) {
  return titles.map((item, index) => {
    const number = index + 1
    const state = number < step ? 'done' : number === step ? 'active' : 'todo'
    return { ...item, number, state }
  })
}

function buildSteps(step) { return stepsOf(STEP_TITLES, step) }

function pad(value) { return String(value).padStart(2, '0') }

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function verifiedWho(verification) {
  if (!verification || !verification.verified) return ''
  return [verification.masked_name, verification.id_tail ? `尾号 ${verification.id_tail}` : ''].filter(Boolean).join('，')
}

// 申请第 1 步的说明：没实名的核验通过即完成实名认证。
function basicHint() {
  return '姓名和身份证号核对一致即完成实名认证，下一步提交申请。'
}

// 申请第 1 步已完成时的说明（已实名的直接算完成）
function basicDoneHint(verification) {
  const who = verifiedWho(verification)
  return who ? `已实名认证（${who}）。` : '身份证姓名和号码已核对一致。'
}

// 申请已提交 / 上次申请的信息行
function applicationRows(application) {
  if (!application) return []
  const rows = [
    { id: 'name', label: '实名信息', value: [application.masked_name, application.id_tail ? `尾号 ${application.id_tail}` : ''].filter(Boolean).join(' · ') || '—' },
    { id: 'phone', label: '联系电话', value: application.contact_phone_masked || '—' },
    { id: 'time', label: '提交时间', value: formatTime(application.submitted_at) || '—' }
  ]
  if (application.note) rows.push({ id: 'note', label: '申请说明', value: application.note })
  return rows
}

// 上次申请没通过：显示原因，可以直接重新申请
function rejectNotice(application) {
  if (!application || application.status !== 'rejected') return null
  return {
    title: '上次申请未通过',
    copy: application.review_note ? `原因：${application.review_note}` : '可以重新提交申请。',
    time: formatTime(application.reviewed_at)
  }
}

const PHONE_PATTERN = /^1\d{10}$/
const ID_CARD_PATTERN = /^\d{17}[\dX]$/

function normalizePhone(value) { return String(value || '').replace(/\s+/g, '') }
function normalizeIdCard(value) { return String(value || '').replace(/\s/g, '').toUpperCase() }

module.exports = {
  STEP_TITLES,
  PHONE_PATTERN,
  ID_CARD_PATTERN,
  applyState,
  currentStep,
  buildSteps,
  basicHint,
  basicDoneHint,
  applicationRows,
  rejectNotice,
  formatTime,
  normalizePhone,
  normalizeIdCard
}
