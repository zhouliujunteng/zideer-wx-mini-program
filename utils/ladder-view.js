// 学习天梯榜（2026-11-17 用户要求）的页面模型：课程服务 /api/learn/ladder（规则 lib/course/ladder.ts）回包 → 页面要画的东西。
// 先比闯关数、再比学习时长；24 点结算，前三名各得 100 金币；榜上名字已由服务端打码。
// 段位表与课程服务 lib/course/ladder-rules.ts 的 LADDER_TIERS 一致，改一边要改另一边（网页端直接用课程服务那份）。

const LADDER_TIERS = [
  { key: 'rookie', label: '见习', min: 0 },
  { key: 'bronze', label: '青铜', min: 1 },
  { key: 'silver', label: '白银', min: 3 },
  { key: 'gold', label: '黄金', min: 6 },
  { key: 'platinum', label: '铂金', min: 10 },
  { key: 'king', label: '王者', min: 15 }
]

const TIER_KEYS = LADDER_TIERS.map((tier) => tier.key)

function int(value) {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function durationText(minutes) {
  const m = int(minutes)
  if (m < 60) return `${m} 分钟`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} 小时 ${rest} 分` : `${h} 小时`
}

/** 顶部总时长用短写法：一个小时以上写「12.9 小时」。 */
function hoursText(minutes) {
  const m = int(minutes)
  return m < 60 ? `${m} 分钟` : `${Math.round(m / 6) / 10} 小时`
}

/** 距结算还有多久：HH:MM:SS（offset = 服务器时间 - 本机时间）。 */
function countdownText(settleAt, nowMs, offset) {
  const target = Date.parse(settleAt || '')
  if (!Number.isFinite(target)) return '--:--:--'
  const left = Math.max(0, target - (nowMs + (offset || 0)))
  const s = Math.floor(left / 1000)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`
}

function tierOf(raw) {
  const key = raw && TIER_KEYS.includes(raw.key) ? raw.key : 'rookie'
  const tier = LADDER_TIERS.find((item) => item.key === key)
  return { key, label: (raw && raw.label) || tier.label }
}

function initialOf(name) {
  const chars = Array.from(String(name || '').replace(/\*/g, ''))
  return chars[0] || '鹿'
}

function avatarOf(url) {
  return typeof url === 'string' && /^https:\/\//.test(url) ? url : ''
}

function rowOf(raw, lead) {
  const passes = int(raw.passes)
  return {
    rank: int(raw.rank),
    name: String(raw.name || '知鹿同学'),
    initial: initialOf(raw.name),
    grade: String(raw.grade || ''),
    avatar: avatarOf(raw.avatarUrl),
    passes,
    time: durationText(raw.minutes),
    tier: tierOf(raw.tier),
    podium: !!raw.podium,
    me: !!raw.me,
    percent: Math.max(4, Math.round((passes / Math.max(1, lead)) * 100))
  }
}

function meTip(me) {
  if (me.toPodium === 0 && me.passes > 0) return '你在前三！守住到 24 点就有金币'
  if (me.toPodium === 0) return '前三还有空位，闯过 1 关就能冲上去'
  return `再闯 ${me.toPodium} 关就能冲进前三`
}

function awardText(award) {
  if (!award) return ''
  const rank = int(award.rank)
  const coins = int(award.coins)
  if (award.status === 'granted') return `昨天你拿了第 ${rank} 名，${coins} 金币已到账！`
  if (award.status === 'rejected') return `昨天你拿了第 ${rank} 名，金币没发出去，请联系老师。`
  return `昨天你拿了第 ${rank} 名，${coins} 金币正在发放。`
}

/** 回包是否像样：不像样返回 null（页面按读取失败处理）。 */
function normalizeLadder(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.rows) || !raw.me || !raw.stats) return null
  return raw
}

function ladderView(raw) {
  const rows = raw.rows.filter((item) => item && typeof item === 'object')
  const lead = rows.length ? int(rows[0].passes) : 0
  const all = rows.map((item) => rowOf(item, lead))
  // 领奖台按 2、1、3 摆
  const seats = [2, 1, 3].map((rank) => {
    const row = all.find((item) => item.rank === rank)
    return { rank, empty: !row, row: row || null }
  })
  const me = raw.me || {}
  const myTier = tierOf(me.tier)
  const reward = raw.reward || {}
  const yesterday = raw.yesterday || {}
  return {
    coins: int(reward.coins) || 100,
    stats: {
      learners: int(raw.stats.learners),
      hours: hoursText(raw.stats.minutes),
      passes: int(raw.stats.passes)
    },
    seats,
    rest: all.filter((item) => item.rank > 3),
    hasRows: all.length > 0,
    me: {
      rankText: me.rank ? `第 ${int(me.rank)} 名` : '未上榜',
      top: !!me.rank && int(me.rank) <= 3,
      passes: int(me.passes),
      time: durationText(me.minutes),
      tier: myTier,
      tip: meTip({ toPodium: int(me.toPodium), passes: int(me.passes) })
    },
    rungs: LADDER_TIERS.slice().reverse().map((tier) => ({
      key: tier.key,
      label: tier.label,
      need: tier.min ? `闯过 ${tier.min} 关` : '学满 1 分钟',
      here: tier.key === myTier.key
    })),
    award: awardText(yesterday.myAward),
    yesterday: {
      settling: !!yesterday.settling,
      learners: int(yesterday.learners),
      podium: (Array.isArray(yesterday.podium) ? yesterday.podium : []).map((item) => ({
        rank: int(item.rank),
        name: String(item.name || '知鹿同学'),
        initial: initialOf(item.name),
        grade: String(item.grade || ''),
        avatar: avatarOf(item.avatarUrl),
        score: `${int(item.passes)} 关 · ${durationText(item.minutes)}`,
        coins: int(item.coins),
        me: !!item.me
      }))
    }
  }
}

module.exports = {
  LADDER_TIERS,
  durationText,
  hoursText,
  countdownText,
  normalizeLadder,
  ladderView
}
