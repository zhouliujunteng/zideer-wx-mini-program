// 深度测评（按学科完整测评）入口的展示数据：宇宙页的入口卡片、测评中心共用。
// 2026-11-14 用户规则：入口放在宇宙页、要显眼；进去能看到哪些学科测过、哪些没测；
// 每做完一科发金币（上线值 2000 金币 / 次、共 5 次 = 100 元），免费版一共只能做 5 次，
// 金币要家长绑定并开通会员后才能提现。规则与数字都来自后端（测评中心回包的 reward，Zion deep-assessment-reward.js），
// 这里只排版；reward 为空 = 活动没开，只显示学科状态。
const COINS_PER_YUAN = 100

// 一个学科测到哪一步：done 做完过整张卷 / doing 做了一部分 / todo 还没测 / unready 题库没准备好
function subjectState(subject) {
  const scopes = subject.scopes || []
  const modeOf = (scope) => (scope.entry && scope.entry.mode) || 'unavailable'
  if (scopes.some((s) => modeOf(s) === 'report' || ((s.entry && s.entry.history) || []).length > 0)) return 'done'
  if (scopes.some((s) => ['resume', 'continue'].includes(modeOf(s)))) return 'doing'
  return Number(subject.readyCount) > 0 ? 'todo' : 'unready'
}

const STATE_LABEL = { done: '已完成', doing: '进行中', todo: '未测评', unready: '准备中' }

function yuanText(coins) {
  const yuan = Number(coins) / COINS_PER_YUAN
  return Number.isInteger(yuan) ? String(yuan) : yuan.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function rewardView(reward) {
  if (!reward || !(Number(reward.coinsPerTest) > 0)) return null
  const coins = Number(reward.coinsPerTest), limit = Number(reward.limit) || 0
  const left = Math.max(0, Number(reward.left) || 0), used = Math.max(0, Number(reward.used) || 0)
  const free = reward.member === false
  const freeLeft = free ? Math.max(0, Number(reward.freeLeft) || 0) : null
  return {
    coins,
    coinsText: `${coins}`,
    limit,
    used,
    left,
    free,
    freeLeft,
    // 免费版次数用完：不能再开新的学科
    freeUsedUp: free && freeLeft === 0,
    totalText: `${limit} 次共 ${coins * limit} 金币（可兑 ${yuanText(coins * limit)} 元）`,
    // 还剩几次：免费版说的是还能开几科，其余说的是还有几次有奖励
    leftText: free ? `免费版还剩 ${freeLeft} 次` : left > 0 ? `有奖测评还剩 ${left} 次` : '奖励已领完',
    rateText: `${COINS_PER_YUAN} 金币 = 1 元`,
    perTestText: `做完一科 ${coins} 金币 ≈ ${yuanText(coins)} 元`,
    yuanPerTest: yuanText(coins),
    // 金币汇总（测评中心顶部）：一共可获得 / 已获得 / 未获得
    totalCoins: coins * limit,
    earnedCoins: coins * used,
    remainingCoins: coins * left,
    totalYuan: yuanText(coins * limit),
    earnedYuan: yuanText(coins * used),
    remainingYuan: yuanText(coins * left),
    percent: limit ? Math.round((used / limit) * 100) : 0,
    rewardedScopeIds: (reward.rewardedScopeIds || []).map(String),
    // 金币结算规则（页面上常驻）
    rules: [
      `每完成一科深度测评（做完这一科的全部轮次），结算一次，${coins} 金币马上到「我的金币」。`,
      `每个学科只奖励一次，重新测不再发；一共最多奖励 ${limit} 次，合计 ${coins * limit} 金币。`,
      `${COINS_PER_YUAN} 金币 = 1 元，${coins * limit} 金币可兑 ${yuanText(coins * limit)} 元。`,
      free
        ? `免费版不分学科一共可以做 ${limit} 次深度测评；金币要家长绑定你、并开通会员后才能提现。`
        : '金币在「我的金币」里兑换成现金，转到微信零钱。'
    ],
    preview: Boolean(reward.preview),
    headline: left > 0 ? `每做完一科得 ${coins} 金币` : `${limit} 次测评奖励已全部领完`,
    progressText: `已领 ${used} / ${limit} 次`,
    earnedText: used ? `已得 ${coins * used} 金币` : '',
    // 给免费版的强提示（进测评中心时弹一次，页面上常驻一条）
    freeTitle: `免费版共可做 ${limit} 次深度测评`,
    freeNotice: free
      ? `不分学科，一共 ${limit} 次，每做完一次得 ${coins} 金币，${limit} 次共 ${coins * limit} 金币（可兑 ${yuanText(coins * limit)} 元）。${freeLeft > 0 ? `你还可以再开 ${freeLeft} 科。` : '你的次数已经用完，没做完的学科可以接着做完。'}金币要家长绑定你、并开通会员后才能提现。`
      : '',
    withdrawTip: free ? '金币要家长绑定你并开通会员后才能提现' : ''
  }
}

function deepAssessmentView(center) {
  const reward = rewardView(center && center.reward)
  const subjects = ((center && center.subjects) || []).map((subject) => {
    const state = subjectState(subject)
    const scopes = subject.scopes || []
    // 这一科拿过奖励没有；还能不能拿：还有奖励次数，并且这一科没拿过
    const rewarded = Boolean(reward && scopes.some((scope) => reward.rewardedScopeIds.includes(String(scope.scopeId))))
    const rewardable = Boolean(reward && reward.left > 0 && !rewarded && state !== 'unready')
    const active = scopes.find((scope) => scope.entry && ['resume', 'continue'].includes(scope.entry.mode))
    const rounds = active && Number(active.roundCount) > 1 ? `已完成 ${Number(active.completedRounds) || 0}/${Number(active.roundCount)} 轮` : ''
    return {
      key: subject.key,
      name: subject.name || subject.key,
      mark: String(subject.name || subject.key || '').slice(0, 1),
      state,
      stateLabel: STATE_LABEL[state],
      roundsLabel: state === 'doing' ? rounds : '',
      rewarded,
      coinLabel: rewardable ? `+${reward.coins} 金币` : '',
      coinYuan: rewardable ? `≈ ${reward.yuanPerTest} 元` : '',
      // 模块上的金币一行：拿过的写已获得，还能拿的写完成可得
      // 活动开始前就做完的学科没拿过奖励：再测一次做完能拿
      coinText: rewarded ? `已获得 ${reward.coins} 金币` : rewardable ? `${state === 'done' ? '再测一次可得' : '完成可得'} ${reward.coins} 金币` : '',
      coinTone: rewarded ? 'earned' : rewardable ? 'pending' : '',
      actionLabel: state === 'done' ? '看报告' : state === 'doing' ? '继续' : state === 'todo' ? '开始' : '准备中',
      // 免费版次数用完后，还没开始的学科开不了
      locked: Boolean(reward && reward.freeUsedUp && state === 'todo')
    }
  })
  const countable = subjects.filter((s) => s.state !== 'unready')
  const done = countable.filter((s) => s.state === 'done').length
  return {
    subjects,
    doneCount: done,
    totalCount: countable.length,
    progressText: countable.length ? `已测 ${done} / ${countable.length} 科` : '题库准备中',
    reward
  }
}

// 开发版预览（只在开发者工具 / 开发版里）：后端的深度测评奖励还没上线、活动没开时回包里没有 reward，
// 页面上的金币汇总和规则就画不出来。开发版里用上线值顶一下方便看界面，并在页面上标「预览数据」；体验版、正式版不走这里。
function previewCenter(center) {
  if (center.reward) return center
  let develop = false
  try { develop = typeof wx !== 'undefined' && wx.getAccountInfoSync().miniProgram.envVersion === 'develop' } catch (error) { develop = false }
  if (!develop) return center
  return { ...center, reward: { coinsPerTest: 2000, limit: 5, used: 0, left: 5, member: null, freeLeft: null, rewardedScopeIds: [], preview: true } }
}

module.exports = { previewCenter, deepAssessmentView, rewardView, subjectState, yuanText }
