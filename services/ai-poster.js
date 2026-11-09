// AI 生成专属推广海报（推广伙伴页 banner → agent/ai-poster，设计仓库 847c572 的 M56）。
// 服务端：课程服务 /api/learn/promotion-poster（OpenMAIC-sync lib/promotion-poster/）。
// 活动清单由运营在管理端「市场运营 · AI 海报活动」维护；提示词在服务端按活动拼，学生只选活动和尺寸，
// 出图用课程服务已配置的生图厂商（千问 / 豆包），带知鹿学习 logo，右下角留白给本人小程序码（由本页合成）。
const { requestCourseApi } = require('./identity')
const { COURSE_PORTAL_ORIGIN } = require('../config/index')

const PATH = '/api/learn/promotion-poster'

// 服务端错误码 → 给用户看的话
const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录后再生成海报。',
  ACCOUNT_UNAVAILABLE: '当前账号暂时不能使用 AI 海报，请联系客服。',
  POSTER_DISABLED: 'AI 海报暂未开放，请稍后再来。',
  ACTIVITY_NOT_FOUND: '这个推广活动已下线，请换一个活动。',
  TEMPLATE_INVALID: '请重新选择海报尺寸。',
  DAILY_LIMIT: '今天的生成次数用完了，明天再来吧。',
  GENERATION_IN_PROGRESS: '上一张海报还在生成，请稍等它完成。',
  POSTER_NOT_FOUND: '没有找到这张海报，请刷新后查看。',
  TRY_LATER: '现在生成的人比较多，请稍后再试。',
  POSTER_UNAVAILABLE: '海报服务暂时不可用，请稍后再试。'
}

function posterError(response) {
  const code = response && response.data && response.data.code || ''
  const error = new Error(MESSAGES[code] || MESSAGES.POSTER_UNAVAILABLE)
  error.code = code || 'POSTER_UNAVAILABLE'
  return error
}

async function call(path, method, data) {
  const response = await requestCourseApi(path, { method, data })
  if (response.statusCode < 200 || response.statusCode >= 300 || !response.data || response.data.success !== true) {
    throw posterError(response)
  }
  return response.data
}

// 服务端回的图片是 /api/promotion-posters/<32 位十六进制>.jpg 这样的相对路径，拼成完整地址；
// 其他形状一律不认（不让接口把页面导向任意地址）。
function posterImageUrl(value) {
  const text = typeof value === 'string' ? value : ''
  const origin = String(COURSE_PORTAL_ORIGIN || '').replace(/\/$/, '')
  return /^\/api\/promotion-posters\/[a-f0-9]{32}\.jpg$/.test(text) ? `${origin}${text}` : ''
}

function normalizePoster(item) {
  if (!item || typeof item !== 'object' || !/^[a-f0-9]{32}$/.test(String(item.id || ''))) return null
  const status = ['generating', 'ready', 'failed'].includes(item.status) ? item.status : 'failed'
  return {
    id: String(item.id),
    activityId: String(item.activityId || ''),
    activityLabel: String(item.activityLabel || ''),
    templateId: String(item.templateId || ''),
    status,
    imageUrl: status === 'ready' ? posterImageUrl(item.image) : '',
    width: Number(item.width) || 0,
    height: Number(item.height) || 0,
    createdAt: String(item.createdAt || ''),
    failure: String(item.failure || '')
  }
}

function normalizeCatalog(data) {
  const activities = (Array.isArray(data.activities) ? data.activities : [])
    .filter((item) => item && /^[a-z0-9-]{1,40}$/.test(String(item.id || '')) && item.label)
    .map((item) => ({
      id: String(item.id),
      label: String(item.label),
      detail: String(item.detail || ''),
      coverUrl: posterImageUrl(item.cover)
    }))
  const templates = (Array.isArray(data.templates) ? data.templates : [])
    .filter((item) => item && /^[a-z]{1,20}$/.test(String(item.id || '')) && item.ratio)
    .map((item) => ({ id: String(item.id), label: String(item.label || ''), ratio: String(item.ratio) }))
  const quota = data.quota && typeof data.quota === 'object' ? data.quota : {}
  return {
    enabled: data.enabled !== false,
    activities,
    templates,
    quota: {
      dailyLimit: Math.max(0, Number(quota.dailyLimit) || 0),
      remaining: Math.max(0, Number(quota.remaining) || 0)
    },
    history: (Array.isArray(data.history) ? data.history : []).map(normalizePoster).filter(Boolean)
  }
}

/** 活动清单、可选尺寸、今天还能生成几张、我的海报历史（新的在前）。 */
async function loadAiPosterCatalog() {
  return normalizeCatalog(await call(PATH, 'GET'))
}

/** 发起生成：服务端立刻回一条 generating 的记录，出图在后台进行（约 30 秒到 2 分钟）。 */
async function startAiPoster(activityId, templateId) {
  const data = await call(PATH, 'POST', { activityId, templateId })
  const poster = normalizePoster(data.poster)
  if (!poster) throw posterError({})
  return { poster, remaining: Math.max(0, Number(data.remaining) || 0) }
}

/** 读一张海报的最新状态（轮询用）。 */
async function loadAiPoster(posterId) {
  if (!/^[a-f0-9]{32}$/.test(String(posterId || ''))) throw posterError({ data: { code: 'POSTER_NOT_FOUND' } })
  const poster = normalizePoster((await call(`${PATH}?id=${posterId}`, 'GET')).poster)
  if (!poster) throw posterError({})
  return poster
}

// ---- 页面展示用 ----

// 三种尺寸（与服务端 lib/promotion-poster/prompt.ts 的 POSTER_TEMPLATES 一致；接口也会回一份，以接口为准）
const POSTER_TEMPLATES = [
  { id: 'portrait', label: '竖版', ratio: '3:4' },
  { id: 'story', label: '长图', ratio: '9:16' },
  { id: 'square', label: '方形', ratio: '1:1' }
]

function pad(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** 历史卡片上的时间：今天 17:06 / 昨天 20:18 / 9月20日 09:30 / 2025年12月1日。 */
function formatPosterTime(value, now = new Date()) {
  const time = new Date(value)
  if (!value || Number.isNaN(time.getTime())) return ''
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}`
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const day = 24 * 60 * 60 * 1000
  if (time.getTime() >= startOfToday) return `今天 ${clock}`
  if (time.getTime() >= startOfToday - day) return `昨天 ${clock}`
  if (time.getFullYear() === now.getFullYear()) return `${time.getMonth() + 1}月${time.getDate()}日 ${clock}`
  return `${time.getFullYear()}年${time.getMonth() + 1}月${time.getDate()}日`
}

/** 历史卡片与完成页要显示的尺寸文字与时间。 */
function decoratePoster(poster, templates = POSTER_TEMPLATES, now = new Date()) {
  const template = templates.find((item) => item.id === poster.templateId) || POSTER_TEMPLATES[0]
  return {
    ...poster,
    templateLabel: template.label,
    ratioLabel: template.ratio,
    createdAtLabel: formatPosterTime(poster.createdAt, now)
  }
}

/** 顶部搜索：按活动名与副标题在已读到的活动里本地过滤。 */
function filterActivities(activities, keyword) {
  const query = String(keyword || '').trim().toLowerCase()
  if (!query) return activities || []
  return (activities || []).filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query))
}

module.exports = {
  loadAiPosterCatalog,
  startAiPoster,
  loadAiPoster,
  posterImageUrl,
  normalizeCatalog,
  normalizePoster,
  POSTER_TEMPLATES,
  formatPosterTime,
  decoratePoster,
  filterActivities
}
