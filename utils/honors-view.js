// 我的荣誉第二版（2026-11-13 用户要求）：课程服务 /api/learn/honors?honors=2 给的荣誉 → 页面模型。
// 规则在课程服务 lib/course/honors-v2.ts：奖杯和勋章都脱离课程内容、全站统一一套——
// 奖杯 3 座各 4 级（铜 → 银 → 金 → 钻石）：闯关杯、勤学杯、恒心杯；勋章 9 枚分 4 组，除「启程」外各 3 级；没有阶段徽章了。
// 图在后端 ui_asset 的 honors/v2/*.png（GPT 生图，scripts/ui-assets/honors/generate-honor-art.mjs）。
// 「新获得」：本机记住看过哪些（SEEN_KEY，每一级一个键），新拿到 / 新升级的在学习页弹一次庆祝、在荣誉页标「新」。

const CUP_KEYS = ['quest', 'diligent', 'streak']
const MEDAL_KEYS = ['onboard', 'run', 'perfect', 'explain', 'review', 'chest', 'hours', 'stage', 'goal']
const CUP_LEVELS = ['铜杯', '银杯', '金杯', '钻石杯']
const GROUPS = [['start', '起步'], ['skill', '实力'], ['collect', '积累'], ['goal', '目标']]
// 第一版的记录在 zhilu_honor_seen，键不一样；换个名字，第二版第一次打开时之前拿的都算看过
const SEEN_KEY = 'zhilu_honor_seen_v2'

// 素材路径写全，verify-ui-assets 才扫得到
const ART = {
  'cup-quest-1': '/assets/honors/v2/cup-quest-1.png',
  'cup-quest-2': '/assets/honors/v2/cup-quest-2.png',
  'cup-quest-3': '/assets/honors/v2/cup-quest-3.png',
  'cup-quest-4': '/assets/honors/v2/cup-quest-4.png',
  'cup-diligent-1': '/assets/honors/v2/cup-diligent-1.png',
  'cup-diligent-2': '/assets/honors/v2/cup-diligent-2.png',
  'cup-diligent-3': '/assets/honors/v2/cup-diligent-3.png',
  'cup-diligent-4': '/assets/honors/v2/cup-diligent-4.png',
  'cup-streak-1': '/assets/honors/v2/cup-streak-1.png',
  'cup-streak-2': '/assets/honors/v2/cup-streak-2.png',
  'cup-streak-3': '/assets/honors/v2/cup-streak-3.png',
  'cup-streak-4': '/assets/honors/v2/cup-streak-4.png',
  'medal-onboard': '/assets/honors/v2/medal-onboard.png',
  'medal-run': '/assets/honors/v2/medal-run.png',
  'medal-perfect': '/assets/honors/v2/medal-perfect.png',
  'medal-explain': '/assets/honors/v2/medal-explain.png',
  'medal-review': '/assets/honors/v2/medal-review.png',
  'medal-chest': '/assets/honors/v2/medal-chest.png',
  'medal-hours': '/assets/honors/v2/medal-hours.png',
  'medal-stage': '/assets/honors/v2/medal-stage.png',
  'medal-goal': '/assets/honors/v2/medal-goal.png'
}

const text = (value) => String(value === undefined || value === null ? '' : value)
const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
const iso = (value) => (/^\d{4}-\d{2}-\d{2}T/.test(text(value)) ? text(value) : '')

function normalizeItem(item, kind) {
  const levels = (Array.isArray(item.levels) ? item.levels : []).map(count).filter(Boolean)
  if (!levels.length) return null
  const level = Math.min(count(item.level), levels.length)
  return {
    kind,
    key: item.key,
    group: kind === 'cup' ? 'cup' : (GROUPS.some(([key]) => key === item.group) ? item.group : 'start'),
    title: text(item.title),
    desc: text(item.desc),
    unit: text(item.unit),
    levels,
    level,
    value: count(item.value),
    unknown: !!item.unknown,
    earnedAt: iso(item.earnedAt)
  }
}

/** 只认第二版（version: 2）；课程服务还是旧的就返回 null。 */
function normalizeHonors(raw) {
  if (!raw || typeof raw !== 'object' || raw.version !== 2) return null
  const list = (value, keys, kind) => (Array.isArray(value) ? value : [])
    .filter((item) => item && keys.includes(item.key))
    .map((item) => normalizeItem(item, kind))
    .filter(Boolean)
  const cups = list(raw.cups, CUP_KEYS, 'cup')
  const medals = list(raw.medals, MEDAL_KEYS, 'medal')
  const earned = (items) => items.filter((item) => item.level > 0).length
  return { summary: { earned: earned(cups) + earned(medals), total: cups.length + medals.length, cups: earned(cups), medals: earned(medals) }, cups, medals }
}

const prefix = (item) => `${item.kind === 'cup' ? 'cup' : 'm2'}:${item.key}`
const itemsOf = (honors) => (honors ? honors.cups.concat(honors.medals) : [])

/** 拿到的每一级一个键（和课程服务 honorKeysV2 同一套写法）。 */
function honorKeys(honors) {
  const keys = []
  itemsOf(honors).forEach((item) => { for (let level = 1; level <= item.level; level += 1) keys.push(`${prefix(item)}:${level}`) })
  return keys
}

function readSeen() {
  try {
    const value = wx.getStorageSync(SEEN_KEY)
    return Array.isArray(value) ? value : null
  } catch (error) {
    return null
  }
}

function writeSeen(keys) {
  try { wx.setStorageSync(SEEN_KEY, keys.slice(-400)) } catch (error) { /* 只影响「新」标记 */ }
}

const artOf = (item, level) => ART[item.kind === 'cup' ? `cup-${item.key}-${Math.max(1, level || item.level)}` : `medal-${item.key}`]
// 这一级叫什么：奖杯是材质，勋章是 Lv.N（只有一级的勋章不写）
const levelLabel = (item, level) => (item.kind === 'cup' ? CUP_LEVELS[level - 1] || '' : (item.levels.length > 1 && level ? `Lv.${level}` : ''))
// 带级别的名字：「闯关杯 · 金杯」「连对高手 Lv.2」
const fullName = (item, level) => {
  const label = levelLabel(item, level)
  return label ? (item.kind === 'cup' ? `${item.title} · ${label}` : `${item.title} ${label}`) : item.title
}
const amount = (value, unit) => `${value}${unit ? ` ${unit}` : ''}`

/**
 * 这次新拿到 / 新升级、本机还没庆祝过的荣誉（一样荣誉只报当前这一级；奖杯在前）。
 * 本机第一次看到荣誉（seen 为 null）：之前拿的都算看过，不一次弹一堆。
 */
function freshHonors(honors, seen) {
  if (!honors || !seen) return []
  const known = new Set(seen)
  return itemsOf(honors)
    .filter((item) => item.level > 0 && !known.has(`${prefix(item)}:${item.level}`))
    .map((item) => ({
      key: `${prefix(item)}:${item.level}`,
      kind: item.kind,
      title: fullName(item, item.level),
      subtitle: item.kind === 'cup' ? (item.level > 1 ? '奖杯升级' : '赢得新奖杯') : (item.level > 1 ? '勋章升级' : '获得新勋章'),
      art: artOf(item)
    }))
}

/** 记住已经看过（庆祝过）的荣誉。没有 seen 时用当前全部初始化。 */
function markSeen(honors, extraKeys) {
  const seen = readSeen() || []
  const merged = Array.from(new Set(seen.concat(extraKeys || honorKeys(honors))))
  writeSeen(merged)
  return merged
}

const dayText = (value) => {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() + 8 * 3600 * 1000)
  return `${local.getUTCFullYear()}/${String(local.getUTCMonth() + 1).padStart(2, '0')}/${String(local.getUTCDate()).padStart(2, '0')}`
}

function itemView(item, known) {
  const earned = item.level > 0
  const next = item.levels[item.level] || 0 // 下一级要达到的数；满级为 0
  const maxed = earned && !next
  const shown = Math.min(item.value, next || item.value)
  // 进度条：还有下一级、进度读得到、而且不是「做一次就拿到」的才画
  const hasBar = !!next && !item.unknown && next > 1
  const percent = next ? Math.round((Math.min(item.value, next) / next) * 100) : 100
  const status = item.unknown
    ? '进度暂时读不到，稍后再来看'
    : maxed
      ? (item.levels.length > 1 ? '已经满级' : '已获得')
      : earned
        ? `现在 ${amount(item.value, item.unit)}，到 ${amount(next, item.unit)} 升到${levelLabel(item, item.level + 1) || '下一级'}`
        : (next > 1 ? `现在 ${amount(item.value, item.unit)}，到 ${amount(next, item.unit)} 就能拿到` : '还没拿到')
  return {
    id: `${item.kind}-${item.key}`,
    kind: item.kind,
    key: item.key,
    title: item.title,
    name: earned && item.kind === 'medal' ? fullName(item, item.level) : item.title,
    levelLabel: earned ? levelLabel(item, item.level) : '',
    art: artOf(item),
    earned,
    level: item.level,
    progress: hasBar ? `${shown}/${next}${item.unit ? ` ${item.unit}` : ''}` : '',
    percent,
    isNew: earned && !known.has(`${prefix(item)}:${item.level}`),
    detail: {
      title: item.title,
      pill: earned ? (levelLabel(item, item.level) || '已获得') : '未获得',
      note: item.desc,
      nextStep: status,
      progress: hasBar ? `${shown} / ${next}${item.unit ? ` ${item.unit}` : ''}` : '',
      percent,
      date: earned ? dayText(item.earnedAt) : '',
      // 每一级：奖杯画出四座杯子，勋章画 Lv 圆点
      ladder: item.levels.length > 1
        ? item.levels.map((target, index) => ({
          id: `${item.key}-${index + 1}`,
          label: levelLabel(item, index + 1),
          target: amount(target, item.unit),
          reached: item.level > index,
          current: item.level === index + 1,
          art: item.kind === 'cup' ? artOf(item, index + 1) : ''
        }))
        : []
    }
  }
}

/**
 * 页面模型：{ summary, showcase（拿到的，最多 6 样）, cups, groups: [{ key, label, earned, total, medals }] }。
 * 每一样都带 id（点开详情）、art、isNew（本机还没看过）。
 */
function honorsView(honors, seen) {
  if (!honors) return null
  const known = new Set(seen || honorKeys(honors))
  const cups = honors.cups.map((item) => itemView(item, known))
  const medals = honors.medals.map((item) => itemView(item, known))
  const groups = GROUPS.map(([key, label]) => {
    const list = medals.filter((view, index) => honors.medals[index].group === key)
    return { key, label, earned: list.filter((view) => view.earned).length, total: list.length, medals: list }
  }).filter((group) => group.total)
  return {
    summary: { ...honors.summary },
    cups,
    cupsEarned: cups.filter((view) => view.earned).length,
    groups
  }
}

/** 按 id 找一样荣誉（点开详情用）。 */
function findHonor(view, id) {
  if (!view || !id) return null
  for (const item of view.cups) if (item.id === id) return item
  for (const group of view.groups) for (const item of group.medals) if (item.id === id) return item
  return null
}

module.exports = { ART, SEEN_KEY, CUP_KEYS, MEDAL_KEYS, normalizeHonors, honorKeys, freshHonors, markSeen, readSeen, honorsView, findHonor, dayText }
