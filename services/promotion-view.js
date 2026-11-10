// 推广伙伴工作台与海报详情的展示计算（2026-09-20）。
// 口径：
// - 余额卡显示真实的推广奖励金额（元），来自 promotion_reward_ledger：
//   status=available 计入「可用奖励」，status=locked 计入「锁定中」，
//   已结算 / 已追偿的流水不计入余额。设计稿的积分口径（2330 ≈ 23.30 元）不适用于本后端。
// - 海报只展示后端已发布的推广素材；失效时间在 3 天内的标「即将结束」。
//   后端动作流已过滤掉过期素材，因此「已结束」态正常情况下不会出现，仅作兜底。


const ENDING_SOON_MS = 3 * 24 * 60 * 60 * 1000
const RATIO_CLASSES = [
  { name: 'ratio-9-16', ratio: 9 / 16 },
  { name: 'ratio-3-4', ratio: 3 / 4 },
  { name: 'ratio-1-1', ratio: 1 },
  { name: 'ratio-16-9', ratio: 16 / 9 }
]
const DEFAULT_RATIO_CLASS = 'ratio-3-4'

function toAmount(value) {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

// 金额按元展示，保留两位小数。
function formatAmount(value) {
  return toAmount(value).toFixed(2)
}

function formatDay(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

// 可用 = 可结算（available / selectable）+ 提现被驳回退回的现金（cash_available）+ 已过锁定期还没来得及解锁的。
// 锁定期满由结算流程惰性解锁（没有定时任务），这里按 locked_until 先算进可用，与结算页口径一致。
const AVAILABLE_STATUSES = ['available', 'selectable', 'cash_available']

function buildBalance(rewards, now = Date.now()) {
  let available = 0
  let locked = 0
  for (const reward of Array.isArray(rewards) ? rewards : []) {
    const status = String(reward && reward.status || '')
    const until = reward && reward.locked_until ? new Date(reward.locked_until).getTime() : NaN
    if (AVAILABLE_STATUSES.includes(status) || (status === 'locked' && Number.isFinite(until) && until <= now)) available += toAmount(reward.amount)
    else if (status === 'locked') locked += toAmount(reward.amount)
  }
  // 小字（用户 2026-09-26）：「可用奖励」下面不写；「锁定中」下面写锁定规则，分两行完整显示，不再截成省略号。
  return {
    availableLabel: '可用奖励',
    availableValue: formatAmount(available),
    lockedLabel: '锁定中',
    lockedValue: formatAmount(locked),
    lockedHintLines: ['锁定期7天', '7天之后可提现']
  }
}

// 顶部状态提示（2026-09-24 按用户口径调整）：
// - 推广伙伴工作台一律不提示资格：海报、邀请码、推广链接对所有登录用户开放。
//   （邀请码中心上线后每个用户都有一份 inactive 的推广档案，09-21 那版只挡了「没有档案」，
//   inactive 用户仍会看到「推广资格暂不可用」，这里一并去掉。）
// - 只有结算中心提示：没有档案或 inactive（普通用户，未开通）→ 提现需开通推广伙伴；
//   停用 / 冻结等真实异常 → 推广资格暂不可用。
// - 2026-09-26 用户口径：推广伙伴由客服开通（线下签《劳务费代扣代发协议》，后台录入资料后开通），
//   所以提示条点击直接拉起企微客服（action: 'service'），不再进资格页。
// - 2026-09-29 用户规则：推广伙伴改为在小程序申请（基础核验 → 提交申请，后台审核开通；10-13 起整个流程不刷脸），
//   提示条点击进「申请成为推广伙伴」页（agent/partner-apply），不再先查实名再找客服。
const HIDDEN_NOTICE = { visible: false, tone: 'success', title: '', copy: '', action: '' }

function buildPartnerNotice(promoter, scene = 'settlement') {
  if (scene !== 'settlement') return { ...HIDDEN_NOTICE }
  const status = String(promoter && promoter.status || '')
  if (status === 'active') return { ...HIDDEN_NOTICE }
  if (!promoter || !status || status === 'inactive') {
    return {
      visible: true,
      tone: 'warning',
      title: '提现需开通推广伙伴',
      copy: '点此申请成为推广伙伴',
      action: 'apply',
      url: '/agent/partner-apply/index'
    }
  }
  return {
    visible: true,
    tone: 'failed',
    title: '推广资格暂不可用',
    copy: '历史奖励与记录仍可查看；如有疑问点此联系客服',
    action: 'service'
  }
}

function buildPosterStatus(asset, now) {
  const expiresAt = asset && asset.expiresAt ? new Date(asset.expiresAt).getTime() : 0
  if (!expiresAt || Number.isNaN(expiresAt)) {
    return { status: 'active', statusLabel: '进行中', statusTone: 'active', validityLabel: '长期有效' }
  }
  const validityLabel = formatDay(asset.expiresAt) || '长期有效'
  if (expiresAt <= now) return { status: 'ended', statusLabel: '已结束', statusTone: 'ended', validityLabel }
  if (expiresAt - now <= ENDING_SOON_MS) {
    return { status: 'ending', statusLabel: '即将结束', statusTone: 'warning', validityLabel }
  }
  return { status: 'active', statusLabel: '进行中', statusTone: 'active', validityLabel }
}

// 后端素材 → 海报卡片。封面缺失时留占位，不隐藏素材（文案本身也有价值）。
function buildPosters(assets, now = Date.now()) {
  return (Array.isArray(assets) ? assets : []).map((asset) => ({
    id: String(asset.id),
    label: String(asset.title || '推广素材'),
    coverSrc: asset.coverImage && asset.coverImage.url ? String(asset.coverImage.url) : '',
    // 封面文件的身份：签名地址每次读取都可能不同，换没换图看文件 id（没有 id 时看去掉签名参数的地址）
    coverKey: asset.coverImage && asset.coverImage.url
      ? String(asset.coverImage.id || String(asset.coverImage.url).split('?')[0])
      : '',
    // 原图文件缺失时退回封面（后台早期发布的素材可能只有封面），保存海报不至于直接失败
    fileSrc: asset.assetFile && asset.assetFile.url
      ? String(asset.assetFile.url)
      : (asset.coverImage && asset.coverImage.url ? String(asset.coverImage.url) : ''),
    campaignLabel: String(asset.campaignKey || '通用推广'),
    copyText: String(asset.copyText || ''),
    ratioClass: DEFAULT_RATIO_CLASS,
    ...buildPosterStatus(asset, now)
  }))
}

// 重新读取海报时沿用上一轮的展示结果（2026-09-25）：封面文件没变的海报保留已量出的卡片比例，
// reuseSrc 时还保留旧的签名地址。否则回到页面时每张卡先退回默认 3:4、封面重新下载，
// 下载完再按真实宽高撑开，看起来就是「闪一下再重新适配」。
function keepPosterLayout(posters, previousPosters, { reuseSrc = false } = {}) {
  const known = new Map()
  for (const item of Array.isArray(previousPosters) ? previousPosters : []) {
    if (item && item.id) known.set(item.id, item)
  }
  return (Array.isArray(posters) ? posters : []).map((poster) => {
    const previous = known.get(poster.id)
    if (!previous || !poster.coverKey || previous.coverKey !== poster.coverKey) return poster
    return {
      ...poster,
      ratioClass: previous.ratioClass || poster.ratioClass,
      coverSrc: reuseSrc && previous.coverSrc ? previous.coverSrc : poster.coverSrc
    }
  })
}

// 两列瀑布流：按顺序左右交替，保持后端的展示顺序。
function splitPosterColumns(posters) {
  const columns = [[], []]
  ;(Array.isArray(posters) ? posters : []).forEach((poster, index) => {
    columns[index % 2].push(poster)
  })
  return columns
}

// 分享图上小程序码的位置：右下角，边距按海报宽度取，码取宽度的 14%
// （微信小程序码最小只能出 280×280，1024 宽的海报上占 27% 太大，
//  所以不用服务端合成，由这里定尺寸后在 canvas 上画。2026-09-22 用户要求缩小 50%。）
const QR_WIDTH_RATIO = 0.14
const QR_MARGIN_RATIO = 0.05
// 白色圆底比码本身大一圈，保证码四周有安静区（扫码识别需要），也压住海报本身的花纹
const QR_BADGE_RATIO = 1.22

function posterQrLayout(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  const size = Math.round(w * QR_WIDTH_RATIO)
  const margin = Math.round(w * QR_MARGIN_RATIO)
  const badge = Math.round(size * QR_BADGE_RATIO)
  const badgeX = Math.max(0, w - badge - margin)
  const badgeY = Math.max(0, h - badge - margin)
  return {
    size,
    // 码居中放在白色圆底里
    x: Math.round(badgeX + (badge - size) / 2),
    y: Math.round(badgeY + (badge - size) / 2),
    badge,
    badgeX,
    badgeY,
    // 圆心与半径，canvas 直接拿来画圆
    centerX: Math.round(badgeX + badge / 2),
    centerY: Math.round(badgeY + badge / 2),
    radius: Math.round(badge / 2)
  }
}

// 图片真实宽高 → 最接近的卡片比例，避免所有海报都按 3:4 裁切。
function matchRatioClass(width, height) {
  const w = Number(width)
  const h = Number(height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return DEFAULT_RATIO_CLASS
  const ratio = w / h
  let matched = RATIO_CLASSES[0]
  for (const item of RATIO_CLASSES) {
    if (Math.abs(item.ratio - ratio) < Math.abs(matched.ratio - ratio)) matched = item
  }
  return matched.name
}

// 小程序链接页（2026-11-10 起链接不带邀请码）。
function shareLinkPageUrl() {
  return '/agent/share-link/index'
}

// 邀请好友卡片的封面（utils/share-cover.js 画，2026-10-04）：海报详情「邀请好友一起」和小程序链接页转发都用它。
// 橙字「好友邀请你」、大标题「一起来知鹿学习」（2026-11-10 起不再写邀请码胶囊）。
function inviteFriendCover() {
  return {
    iconKey: '/assets/help/guide-invite.png',
    text: { kicker: '好友邀请你', title: '一起来知鹿学习', label: '' }
  }
}

module.exports = {
  posterQrLayout,
  shareLinkPageUrl,
  inviteFriendCover,
  formatAmount,
  formatDay,
  buildBalance,
  buildPartnerNotice,
  buildPosters,
  keepPosterLayout,
  splitPosterColumns,
  matchRatioClass,
  DEFAULT_RATIO_CLASS
}
