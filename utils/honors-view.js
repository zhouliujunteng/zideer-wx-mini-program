// 我的荣誉（2026-11-11 晚用户确认）：课程服务 /api/learn/honors 给的荣誉 → 页面模型。
// 规则在课程服务 lib/course/honors.ts：奖杯一节课一座（金 = 练习一次全对且验收一次通过、银 = 其中一项、铜 = 都不是）；
// 阶段徽章 = 一个阶段的课都过了验收；里程碑勋章 13 枚（没拿到给进度）。图在后端 ui_asset 的 honors/*.svg。
// 「新获得」：本机记住看过哪些荣誉（SEEN_KEY），新拿到的在学习页弹一次庆祝、在荣誉页标「新」。

const TIERS = ['gold', 'silver', 'bronze']
const TIER_LABELS = { gold: '金杯', silver: '银杯', bronze: '铜杯' }
const STAGE_TONES = ['orange', 'blue', 'violet', 'teal', 'rose']
const MEDAL_KEYS = ['onboard', 'first-lesson', 'streak-7', 'streak-30', 'streak-100', 'run-10', 'perfect', 'explain-5', 'lessons-10', 'reviews-20', 'chests-10', 'stage-1', 'goal']
const GROUPS = [['start', '起步'], ['persist', '坚持'], ['skill', '实力'], ['collect', '积累'], ['goal', '目标']]
const SEEN_KEY = 'zhilu_honor_seen'

// 素材路径写全，verify-ui-assets 才扫得到
const ART = {
  'trophy-gold': '/assets/honors/trophy-gold.svg',
  'trophy-silver': '/assets/honors/trophy-silver.svg',
  'trophy-bronze': '/assets/honors/trophy-bronze.svg',
  'trophy-empty': '/assets/honors/trophy-empty.svg',
  'stage-orange': '/assets/honors/stage-orange.svg',
  'stage-blue': '/assets/honors/stage-blue.svg',
  'stage-violet': '/assets/honors/stage-violet.svg',
  'stage-teal': '/assets/honors/stage-teal.svg',
  'stage-rose': '/assets/honors/stage-rose.svg',
  'stage-locked': '/assets/honors/stage-locked.svg',
  'medal-onboard': '/assets/honors/medal-onboard.svg',
  'medal-onboard-locked': '/assets/honors/medal-onboard-locked.svg',
  'medal-first-lesson': '/assets/honors/medal-first-lesson.svg',
  'medal-first-lesson-locked': '/assets/honors/medal-first-lesson-locked.svg',
  'medal-streak-7': '/assets/honors/medal-streak-7.svg',
  'medal-streak-7-locked': '/assets/honors/medal-streak-7-locked.svg',
  'medal-streak-30': '/assets/honors/medal-streak-30.svg',
  'medal-streak-30-locked': '/assets/honors/medal-streak-30-locked.svg',
  'medal-streak-100': '/assets/honors/medal-streak-100.svg',
  'medal-streak-100-locked': '/assets/honors/medal-streak-100-locked.svg',
  'medal-run-10': '/assets/honors/medal-run-10.svg',
  'medal-run-10-locked': '/assets/honors/medal-run-10-locked.svg',
  'medal-perfect': '/assets/honors/medal-perfect.svg',
  'medal-perfect-locked': '/assets/honors/medal-perfect-locked.svg',
  'medal-explain-5': '/assets/honors/medal-explain-5.svg',
  'medal-explain-5-locked': '/assets/honors/medal-explain-5-locked.svg',
  'medal-lessons-10': '/assets/honors/medal-lessons-10.svg',
  'medal-lessons-10-locked': '/assets/honors/medal-lessons-10-locked.svg',
  'medal-reviews-20': '/assets/honors/medal-reviews-20.svg',
  'medal-reviews-20-locked': '/assets/honors/medal-reviews-20-locked.svg',
  'medal-chests-10': '/assets/honors/medal-chests-10.svg',
  'medal-chests-10-locked': '/assets/honors/medal-chests-10-locked.svg',
  'medal-stage-1': '/assets/honors/medal-stage-1.svg',
  'medal-stage-1-locked': '/assets/honors/medal-stage-1-locked.svg',
  'medal-goal': '/assets/honors/medal-goal.svg',
  'medal-goal-locked': '/assets/honors/medal-goal-locked.svg'
}

const text = (value) => String(value === undefined || value === null ? '' : value)
const count = (value) => Math.max(0, Math.floor(Number(value) || 0))
const iso = (value) => (/^\d{4}-\d{2}-\d{2}T/.test(text(value)) ? text(value) : '')

function normalizeHonors(raw) {
  if (!raw || typeof raw !== 'object') return null
  const summary = raw.summary || {}
  return {
    summary: {
      trophies: count(summary.trophies),
      gold: count(summary.gold),
      badges: count(summary.badges),
      medals: count(summary.medals),
      medalTotal: count(summary.medalTotal) || MEDAL_KEYS.length
    },
    trophies: (Array.isArray(raw.trophies) ? raw.trophies : []).map((item) => ({
      stageId: text(item && item.stageId),
      title: text(item && item.title) || '定制课程',
      tier: TIERS.includes(item && item.tier) ? item.tier : null,
      hint: text(item && item.hint),
      earnedAt: iso(item && item.earnedAt)
    })).filter((item) => item.stageId),
    badges: (Array.isArray(raw.badges) ? raw.badges : []).map((item, index) => ({
      id: text(item && item.id),
      number: count(item && item.number) || index + 1,
      title: text(item && item.title) || `第 ${index + 1} 阶段`,
      earned: !!(item && item.earned),
      done: count(item && item.done),
      total: count(item && item.total),
      earnedAt: iso(item && item.earnedAt)
    })).filter((item) => item.id),
    medals: (Array.isArray(raw.medals) ? raw.medals : []).filter((item) => item && MEDAL_KEYS.includes(item.key)).map((item) => ({
      key: item.key,
      group: GROUPS.some(([key]) => key === item.group) ? item.group : 'start',
      title: text(item.title),
      desc: text(item.desc),
      earned: !!item.earned,
      value: count(item.value),
      target: count(item.target) || 1,
      unit: text(item.unit),
      unknown: !!item.unknown,
      earnedAt: iso(item.earnedAt)
    }))
  }
}

/** 一份荣誉里每一样的键（和课程服务 honorKeys 同一套写法）。 */
function honorKeys(honors) {
  if (!honors) return []
  return [
    ...honors.trophies.filter((item) => item.tier).map((item) => `trophy:${item.stageId}:${item.tier}`),
    ...honors.badges.filter((item) => item.earned).map((item) => `badge:${item.id}`),
    ...honors.medals.filter((item) => item.earned).map((item) => `medal:${item.key}`)
  ]
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

/**
 * 这次新拿到、本机还没庆祝过的荣誉（按 勋章 → 阶段徽章 → 奖杯 的顺序，最显眼的在前）。
 * 本机第一次看到荣誉（seen 为 null）：之前拿的都算看过，不一次弹一堆。
 */
function freshHonors(honors, seen) {
  if (!honors || !seen) return []
  const known = new Set(seen)
  const items = []
  honors.medals.filter((item) => item.earned && !known.has(`medal:${item.key}`)).forEach((item) => items.push({ key: `medal:${item.key}`, kind: 'medal', title: item.title, subtitle: '获得新勋章', art: ART[`medal-${item.key}`] }))
  honors.badges.filter((item) => item.earned && !known.has(`badge:${item.id}`)).forEach((item) => items.push({ key: `badge:${item.id}`, kind: 'badge', title: item.title, subtitle: `点亮第 ${item.number} 阶段徽章`, art: ART[`stage-${STAGE_TONES[(item.number - 1) % STAGE_TONES.length]}`], number: item.number }))
  honors.trophies.filter((item) => item.tier && !known.has(`trophy:${item.stageId}:${item.tier}`)).forEach((item) => items.push({ key: `trophy:${item.stageId}:${item.tier}`, kind: 'trophy', title: item.title, subtitle: `赢得一座${TIER_LABELS[item.tier]}`, art: ART[`trophy-${item.tier}`] }))
  return items
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
  return `${local.getUTCFullYear()}.${String(local.getUTCMonth() + 1).padStart(2, '0')}.${String(local.getUTCDate()).padStart(2, '0')}`
}

/**
 * 页面模型：{ summary, shelves: [[奖杯 ×3]...], badges, groups: [{ key, label, medals }] }。
 * 每一样都带 id（点开详情）、art、isNew（本机还没看过）。
 */
function honorsView(honors, seen) {
  if (!honors) return null
  const known = new Set(seen || honorKeys(honors))
  const trophies = honors.trophies.map((item, index) => ({
    id: `trophy-${index}`,
    kind: 'trophy',
    title: item.title,
    tier: item.tier || '',
    tierLabel: item.tier ? TIER_LABELS[item.tier] : '待闯',
    art: ART[item.tier ? `trophy-${item.tier}` : 'trophy-empty'],
    earned: !!item.tier,
    isNew: !!item.tier && !known.has(`trophy:${item.stageId}:${item.tier}`),
    detail: item.tier
      ? { title: item.title, badge: TIER_LABELS[item.tier], note: item.tier === 'gold' ? '练习一次全对，验收一次通过，完美！' : item.hint, date: dayText(item.earnedAt) }
      : { title: item.title, badge: '待闯', note: '把这节课的看课、互动练习、AI 老师验收都闯过，就能赢得一座奖杯', date: '' }
  }))
  // 奖杯柜每层 3 座（大屏下样式里排成 5 座一层，见 wxss）
  const shelves = []
  for (let index = 0; index < trophies.length; index += 3) shelves.push({ id: `shelf-${index}`, items: trophies.slice(index, index + 3) })
  const badges = honors.badges.map((item) => {
    const tone = STAGE_TONES[(item.number - 1) % STAGE_TONES.length]
    return {
      id: `badge-${item.id}`,
      kind: 'badge',
      number: item.number,
      title: item.title,
      art: ART[item.earned ? `stage-${tone}` : 'stage-locked'],
      earned: item.earned,
      progress: item.total ? `${Math.min(item.done, item.total)}/${item.total} 节` : '',
      percent: item.total ? Math.round((Math.min(item.done, item.total) / item.total) * 100) : 0,
      isNew: item.earned && !known.has(`badge:${item.id}`),
      detail: { title: `第 ${item.number} 阶段 · ${item.title}`, badge: item.earned ? '已点亮' : '未点亮', note: item.earned ? '这一阶段的课全部闯过了验收' : `这一阶段的课都闯过验收就能点亮，现在 ${Math.min(item.done, item.total)}/${item.total} 节`, date: dayText(item.earnedAt) }
    }
  })
  const groups = GROUPS.map(([key, label]) => ({
    key,
    label,
    medals: honors.medals.filter((item) => item.group === key).map((item) => ({
      id: `medal-${item.key}`,
      kind: 'medal',
      title: item.title,
      art: ART[item.earned ? `medal-${item.key}` : `medal-${item.key}-locked`],
      earned: item.earned,
      // 进度条（只给要攒的勋章）：目标是 1 的不画
      progress: !item.earned && item.target > 1 && !item.unknown ? `${item.value}/${item.target}${item.unit === '天' || item.unit === '节' || item.unit === '题' || item.unit === '次' || item.unit === '个' ? ` ${item.unit}` : ''}` : '',
      percent: item.target ? Math.round((Math.min(item.value, item.target) / item.target) * 100) : 0,
      isNew: item.earned && !known.has(`medal:${item.key}`),
      detail: { title: item.title, badge: item.earned ? '已获得' : '未获得', note: item.desc, date: dayText(item.earnedAt), progress: !item.earned && item.target > 1 && !item.unknown ? `${item.value} / ${item.target}` : '', percent: item.target ? Math.round((Math.min(item.value, item.target) / item.target) * 100) : 0 }
    }))
  })).filter((group) => group.medals.length)
  const summary = honors.summary
  return {
    summary: {
      trophies: summary.trophies,
      gold: summary.gold,
      badges: summary.badges,
      badgeTotal: honors.badges.length,
      medals: summary.medals,
      medalTotal: summary.medalTotal,
      total: summary.trophies + summary.badges + summary.medals
    },
    shelves,
    hasTrophies: trophies.length > 0,
    hasBadges: badges.length > 0,
    badges,
    groups
  }
}

/** 按 id 找一样荣誉（点开详情用）。 */
function findHonor(view, id) {
  if (!view || !id) return null
  for (const shelf of view.shelves) for (const item of shelf.items) if (item.id === id) return item
  for (const item of view.badges) if (item.id === id) return item
  for (const group of view.groups) for (const item of group.medals) if (item.id === id) return item
  return null
}

module.exports = { ART, SEEN_KEY, normalizeHonors, honorKeys, freshHonors, markSeen, readSeen, honorsView, findHonor, dayText }
