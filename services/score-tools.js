// 首页 AI 提分工具（方案 ../docs/AI提分工具适配方案.md）。服务端：课程服务 /api/learn/score-tools/**（OpenMAIC-sync lib/score-tools/）。
// 流程：拍题上传 → 识题（服务端后台识别，本端轮询）→ 学生选题、改字确认 → 发起工具分析（后台，轮询）→ 看结果。
// 收费（2026-10-08 用户决定）：每个工具每天免费 3 次；超出后会员每次扣积分（服务端给价格），非会员当天用完就不能再用。
const { requestCourseApi, requestCourseUpload } = require('./identity')
const { LIVE_SCORE_TOOLS } = require('../utils/score-tools-live')

const BASE = '/api/learn/score-tools'
const ID = /^[a-f0-9]{32}$/

// 工具页的说明与补充输入。needsAnswer：要学生作答（错因诊断没有作答不下结论）。
const TOOL_PAGES = {
  'question-review': {
    title: '审题拆解',
    intro: '拍一道题，先把题读准：找出任务词、限制条件、隐藏条件和容易漏读的地方。只审题，不给答案。',
    needsAnswer: false,
    inputs: [{ key: 'note', label: '补充说明', placeholder: '选填，例如：这是第二章的练习题', maxlength: 200 }]
  },
  'error-diagnosis': {
    title: '错因诊断',
    intro: '拍下题目和你的作答，找到第一个出错的地方，分清是知识、审题、方法还是计算的问题。',
    needsAnswer: true,
    inputs: [
      { key: 'selfDiagnosis', label: '我觉得自己错在', placeholder: '选填，写下你的判断，和 AI 的对比一下', maxlength: 200 },
      { key: 'correctAnswer', label: '标准答案', placeholder: '选填，有答案的话填上，诊断更准', maxlength: 500 }
    ]
  },
  // 举一反三（10-08 第二版）：出 3 道练习在这里直接做，服务端判对错；作答选填，有作答出的易错题更对路。
  'error-variation': {
    title: '举一反三',
    intro: '拍一道做错的题，出 3 道同类练习：基础巩固、易错辨析、迁移应用，每道都经过 AI 独立复核，做完马上判对错。',
    needsAnswer: false,
    answerOptional: true,
    inputs: [{ key: 'focus', label: '想重点练', placeholder: '选填，例如：去分母这一步总出错', maxlength: 100 }]
  }
}

const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录。',
  COURSE_ACCESS_DENIED: '请先完善学习资料后再使用提分工具。',
  FILE_REQUIRED: '请先拍一张题目照片。',
  FILE_TOO_LARGE: '照片太大了，请换一张再试。',
  IMAGE_INVALID: '这张照片打不开，请换一张再试。',
  UPLOADS_INVALID: '请重新选择照片（一次最多 3 张）。',
  UPLOAD_NOT_FOUND: '照片已失效，请重新拍照。',
  RECOGNITION_DAILY_LIMIT: '今天识别的题目太多了，明天再来吧。',
  QUESTION_NOT_FOUND: '没有找到这道题，请重新拍照。',
  QUESTION_NOT_READY: '题目还没识别好，请稍等。',
  QUESTION_NOT_CONFIRMED: '请先确认题目文字。',
  QUESTION_INDEX_INVALID: '请重新选择一道题。',
  STEM_REQUIRED: '题目文字不能为空。',
  STUDENT_ANSWER_REQUIRED: '错因诊断要看你的作答，请把作答也填上。',
  TOOL_INVALID: '这个工具暂时用不了。',
  TOOL_NOT_AVAILABLE: '这个工具即将上线，敬请期待。',
  RUN_IN_PROGRESS: '上一次分析还没完成，请稍等它结束。',
  DAILY_LIMIT: '今天的免费次数用完了，明天再来吧。',
  CHARGE_CONFIRM_REQUIRED: '今天的免费次数用完了。',
  INSUFFICIENT_CREDITS: '积分不够了。',
  MEMBERSHIP_UNAVAILABLE: '暂时查不到会员状态，请稍后再试。',
  CREDITS_UNAVAILABLE: '暂时查不到积分余额，请稍后再试。',
  RUN_NOT_FOUND: '没有找到这条记录。',
  PRACTICE_INDEX_INVALID: '没有找到这道练习。',
  PRACTICE_ANSWER_REQUIRED: '先选一个答案或填上答案。',
  PRACTICE_ALREADY_ANSWERED: '这道题已经交过了。',
  TRY_LATER: '现在用的人比较多，请稍后再试。',
  DATABASE_UNAVAILABLE: '提分工具暂时不可用，请稍后再试。',
  SCORE_TOOLS_UNAVAILABLE: '提分工具暂时不可用，请稍后再试。'
}

// 识题、分析失败的原因（服务端 failureOf）→ 给学生看的话
const FAILURES = {
  unclear: '照片看不清，请换个角度、光线亮一点再拍。',
  timeout: '这次分析时间太长了，请重试。',
  content: '内容没有通过安全检查，请换一道题。',
  output: '这次没分析好，请重试。',
  interrupted: '分析被中断了，请重试。',
  error: '这次没分析好，请稍后重试。'
}

function scoreToolError(response) {
  const data = response && response.data || {}
  const code = String(data.code || 'SCORE_TOOLS_UNAVAILABLE')
  const error = new Error(MESSAGES[code] || MESSAGES.SCORE_TOOLS_UNAVAILABLE)
  error.code = code
  error.price = Number(data.price) || 0
  error.available = Number(data.available) || 0
  error.member = data.member !== false
  return error
}

async function call(path, method = 'GET', data) {
  const response = await requestCourseApi(`${BASE}${path}`, { method, data })
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.data || response.data.success !== true) {
    throw scoreToolError(response)
  }
  return response.data
}

/** 各工具今天还剩几次免费、超出后每次多少积分。 */
async function loadScoreToolQuota() {
  const data = await call('')
  return {
    freeDaily: Number(data.freeDaily) || 3,
    price: Number(data.price) || 0,
    tools: (Array.isArray(data.tools) ? data.tools : []).map((tool) => ({
      id: String(tool.id || ''),
      label: String(tool.label || ''),
      live: tool.live === true,
      usedToday: Number(tool.usedToday) || 0,
      freeRemaining: Math.max(0, Number(tool.freeRemaining) || 0)
    }))
  }
}

function readLocalFile(filePath) {
  return new Promise((resolve, reject) => wx.getFileSystemManager().readFile({
    filePath,
    success: (result) => resolve(result.data),
    fail: () => reject(new Error('照片读取失败，请重新选择。'))
  }))
}

/** 上传一张题目照片，回 uploadId。 */
async function uploadQuestionPhoto(filePath) {
  const bytes = await readLocalFile(filePath)
  if (!bytes || !bytes.byteLength) throw new Error('照片读取失败，请重新选择。')
  if (bytes.byteLength > 10 * 1024 * 1024) throw scoreToolError({ data: { code: 'FILE_TOO_LARGE' } })
  const extension = String(filePath).split('.').pop().toLowerCase()
  const contentType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
  const response = await requestCourseUpload(`${BASE}/uploads`, { bytes, fileName: `question.${extension === 'png' || extension === 'webp' ? extension : 'jpg'}`, contentType })
  if (response.statusCode !== 201 || !response.data || !ID.test(String(response.data.uploadId || ''))) throw scoreToolError(response)
  return String(response.data.uploadId)
}

function normalizeQuestion(item) {
  if (!item || !ID.test(String(item.id || ''))) throw scoreToolError({})
  return {
    id: String(item.id),
    status: ['recognizing', 'ready', 'failed'].includes(item.status) ? item.status : 'failed',
    failure: String(item.failure || ''),
    failureText: item.status === 'failed' ? (String(item.message || '') || FAILURES[item.failure] || FAILURES.error) : '',
    message: String(item.message || ''),
    subject: String(item.subject || ''),
    questions: (Array.isArray(item.questions) ? item.questions : []).map((q, index) => ({
      index,
      label: String(q.label || `第${index + 1}题`),
      stem: String(q.stem || ''),
      studentAnswer: String(q.studentAnswer || ''),
      teacherMarks: String(q.teacherMarks || ''),
      hasFigure: q.hasFigure === true
    })),
    selectedIndex: Number(item.selectedIndex) || 0,
    stem: String(item.stem || ''),
    studentAnswer: String(item.studentAnswer || ''),
    confirmed: item.confirmed === true
  }
}

async function startRecognition(uploadIds) {
  return normalizeQuestion((await call('/questions', 'POST', { uploadIds })).question)
}

async function loadQuestion(id) {
  return normalizeQuestion((await call(`/questions?id=${id}`)).question)
}

async function confirmQuestion({ id, selectedIndex, stem, studentAnswer }) {
  return normalizeQuestion((await call('/questions', 'PATCH', { id, selectedIndex, stem, studentAnswer })).question)
}

function normalizeRun(item) {
  if (!item || !ID.test(String(item.id || ''))) throw scoreToolError({})
  const status = ['queued', 'running', 'succeeded', 'failed'].includes(item.status) ? item.status : 'failed'
  return {
    id: String(item.id),
    tool: String(item.tool || ''),
    toolLabel: String(item.toolLabel || ''),
    questionId: String(item.questionId || ''),
    question: item.question ? { stem: String(item.question.stem || ''), studentAnswer: String(item.question.studentAnswer || '') } : null,
    status,
    pending: status === 'queued' || status === 'running',
    failureText: status === 'failed' ? (FAILURES[item.failure] || FAILURES.error) : '',
    billing: item.billing === 'credits' ? 'credits' : 'free',
    credits: Number(item.credits) || 0,
    result: item.result || null,
    createdAt: String(item.createdAt || '')
  }
}

/** 发起分析。超出免费次数时抛错：code 为 CHARGE_CONFIRM_REQUIRED（带 price）时确认后带 acceptCharge 重发。 */
async function startScoreToolRun({ tool, questionId, input, acceptCharge = false }) {
  return normalizeRun((await call('/runs', 'POST', { tool, questionId, input, acceptCharge })).run)
}

async function loadScoreToolRun(id) {
  if (!ID.test(String(id || ''))) throw scoreToolError({ data: { code: 'RUN_NOT_FOUND' } })
  return normalizeRun((await call(`/runs?id=${id}`)).run)
}

async function loadScoreToolRuns() {
  const data = await call('/runs')
  return (Array.isArray(data.runs) ? data.runs : []).map((item) => {
    try { return normalizeRun(item) } catch (error) { return null }
  }).filter(Boolean)
}

/** 举一反三：交一道练习的答案，服务端判对错，回整条记录（答过的题才带答案和解析）。 */
async function answerPractice({ id, index, answer }) {
  return normalizeRun((await call('/runs', 'PATCH', { id, index, answer })).run)
}

async function deleteScoreToolRun(id) {
  await call(`/runs?id=${id}`, 'DELETE')
}

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** 记录时间：今天显示「今天 14:05」，其余「10月7日 14:05」。 */
function formatRunTime(iso, now = new Date()) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()
  return sameDay ? `今天 ${time}` : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
}

module.exports = {
  LIVE_SCORE_TOOLS,
  TOOL_PAGES,
  loadScoreToolQuota,
  uploadQuestionPhoto,
  startRecognition,
  loadQuestion,
  confirmQuestion,
  startScoreToolRun,
  loadScoreToolRun,
  loadScoreToolRuns,
  answerPractice,
  deleteScoreToolRun,
  formatRunTime
}
