// 学习页成就卡（集卡，2026-10-13）。服务端：课程服务 /api/learn/achievement-cards（OpenMAIC-sync lib/achievement-cards/）。
// 系列 → 卡 → 等级。2026-10-14 起：每个系列定一种任务，完成 1 次给这个系列抽卡次数；抽卡在整个系列里按概率抽（服务端抽），
// 任务做得越多稀有等级概率越高；抽到已有的变碎片，碎片在碎片商店换通用次数（任何系列都能用）。
// 系列、卡、卡图、任务都由运营在管理端「市场运营 · 成就卡」维护。
const { requestCourseApi } = require('./identity')
const { COURSE_PORTAL_ORIGIN } = require('../config/index')

const PATH = '/api/learn/achievement-cards'

const MESSAGES = {
  LOGIN_REQUIRED: '登录已过期，请重新登录。',
  COURSE_ACCESS_DENIED: '请先完善学习资料。',
  CARD_NOT_FOUND: '这张卡已下架，请刷新看看。',
  NO_DRAWS: '这个系列暂时没有抽卡次数，完成任务就能获得。',
  SERIES_NOT_FOUND: '这个系列已下架，请刷新看看。',
  NOT_ENOUGH_FRAGMENTS: '碎片还不够，再抽几次重复的卡就攒够啦。',
  CARDS_UNAVAILABLE: '成就卡暂时读不到，请稍后再试。'
}

function cardsError(response) {
  const code = response && response.data && response.data.code || ''
  const error = new Error(MESSAGES[code] || MESSAGES.CARDS_UNAVAILABLE)
  error.code = code || 'CARDS_UNAVAILABLE'
  error.statusCode = response && response.statusCode
  return error
}

// 卡图是 /api/achievement-cards/<32 位十六进制>.<png|jpg|webp> 相对路径，拼成完整地址；其他形状一律不认。
function cardImageUrl(value) {
  const text = typeof value === 'string' ? value : ''
  const origin = String(COURSE_PORTAL_ORIGIN || '').replace(/\/$/, '')
  return /^\/api\/achievement-cards\/[a-f0-9]{32}\.(png|jpg|webp)$/.test(text) ? `${origin}${text}` : ''
}

const COLOR = /^#[0-9a-fA-F]{6}$/
const int = (value) => Math.max(0, Math.floor(Number(value) || 0))

// 26/10/11（与参考设计同一写法）
function shortDate(iso) {
  const time = Date.parse(iso || '')
  if (!Number.isFinite(time)) return ''
  const d = new Date(time + 8 * 3600 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${String(d.getUTCFullYear()).slice(2)}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`
}

const num1 = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n * 10) / 10 : 0
}

function normalizeLevel(level, index) {
  const boost = level.boost && typeof level.boost === 'object' ? level.boost : null
  return {
    id: int(level.id),
    no: int(level.no) || index + 1,
    image: cardImageUrl(level.image),
    // 当前抽中这一级的概率（%，整个系列加起来是 100）
    probability: num1(level.probability),
    // 加成：「每完成 1 次复习，抽中概率 +0.5%」，已加多少、最多加多少
    boost: boost ? { text: String(boost.text || ''), added: num1(boost.added), cap: num1(boost.cap) } : null,
    owned: int(level.owned),
    lastDrawn: shortDate(level.lastDrawnAt)
  }
}

function normalizeCard(card, seriesId) {
  const levels = (Array.isArray(card.levels) ? card.levels : []).filter((l) => l && l.id).map(normalizeLevel)
  return {
    id: int(card.id),
    seriesId,
    title: String(card.title || ''),
    color: COLOR.test(String(card.color)) ? card.color : '#FD7C02',
    cover: cardImageUrl(card.cover),
    coverNo: int(card.coverNo) || 1,
    ownedLevels: int(card.ownedLevels),
    ownedCards: int(card.ownedCards),
    totalLevels: int(card.totalLevels) || levels.length,
    lastDrawn: shortDate(card.lastDrawnAt),
    levels
  }
}

// 2026-10-14 起：每个系列定一种任务，做任务给这个系列抽卡次数；抽卡在整个系列里抽；通用次数（兑换码、碎片换的）任何系列都能用
function normalizeCards(data) {
  const summary = data && data.summary || {}
  const bonusDraws = int(summary.bonusDraws)
  const series = (Array.isArray(data && data.series) ? data.series : [])
    .filter((s) => s && s.id)
    .map((s) => {
      const id = int(s.id)
      const task = s.task && typeof s.task === 'object' ? s.task : null
      const own = int(s.drawsAvailable)
      return {
        id,
        title: String(s.title || ''),
        subtitle: String(s.subtitle || ''),
        task: task ? { text: String(task.text || ''), earnedToday: int(task.earnedToday), dailyCap: int(task.dailyCap) } : null,
        // 这个系列自己的次数；drawsTotal 含通用次数（在这个系列里一共能抽几次）
        drawsAvailable: own,
        drawsTotal: own + bonusDraws,
        cards: (Array.isArray(s.cards) ? s.cards : []).filter((c) => c && c.id).map((c) => normalizeCard(c, id)).filter((c) => c.levels.length)
      }
    })
    .filter((s) => s.cards.length)
  return {
    quote: String(data && data.hero && data.hero.quote || ''),
    ownedLevels: int(summary.ownedLevels),
    totalLevels: int(summary.totalLevels),
    drawsAvailable: int(summary.drawsAvailable),
    bonusDraws,
    fragments: int(summary.fragments),
    exchangeCost: int(summary.exchangeCost) || 60,
    duplicateFragments: int(summary.duplicateFragments) || 10,
    series
  }
}

async function loadAchievementCards() {
  const response = await requestCourseApi(PATH)
  if (response.statusCode !== 200 || !response.data || !Array.isArray(response.data.series)) throw cardsError(response)
  return normalizeCards(response.data)
}

/** 在一个系列里抽一张（服务端按当前概率抽，一定出一张；抽到已有的变碎片）。 */
async function drawInSeries(seriesId) {
  const response = await requestCourseApi(PATH, { method: 'POST', data: { operation: 'draw', seriesId } })
  const draw = response.data && response.data.draw
  if (response.statusCode !== 200 || !draw || !draw.levelId) throw cardsError(response)
  return {
    cardId: int(draw.cardId),
    levelId: int(draw.levelId),
    no: int(draw.no),
    isNew: draw.isNew === true,
    owned: int(draw.owned),
    fragments: int(draw.fragments),
    fragmentBalance: int(draw.fragmentBalance),
    lastDrawn: shortDate(draw.drawnAt),
    source: draw.source === 'bonus' ? 'bonus' : 'series'
  }
}

/** 碎片换 1 次通用抽卡次数。 */
async function exchangeFragments() {
  const response = await requestCourseApi(PATH, { method: 'POST', data: { operation: 'exchange' } })
  const result = response.data && response.data.exchange
  if (response.statusCode !== 200 || !result) throw cardsError(response)
  return { fragments: int(result.fragments), bonusDraws: int(result.bonusDraws), exchangeCost: int(result.exchangeCost) }
}

function findSeries(model, seriesId) {
  return (model && model.series || []).find((s) => s.id === seriesId) || null
}

// 学习页横条：点亮过的在前（最近抽的在前），再是还没拿到的；最多 12 张
function stripCards(model, limit = 12) {
  const cards = []
  ;(model && model.series || []).forEach((s) => s.cards.forEach((c) => cards.push(c)))
  const rank = (c) => (c.ownedLevels > 0 ? 0 : 1)
  return cards
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (b.c.lastDrawn > a.c.lastDrawn ? 1 : b.c.lastDrawn < a.c.lastDrawn ? -1 : 0) || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.c)
}

module.exports = { loadAchievementCards, drawInSeries, exchangeFragments, normalizeCards, stripCards, findSeries, cardImageUrl, shortDate }
