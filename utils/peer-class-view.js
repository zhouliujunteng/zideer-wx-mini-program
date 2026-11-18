// 当小老师（复述验收改版，2026-11-17，docs/当小老师记录.md）：孩子当小老师，给两三个 AI 同学讲刚学的课。
// 这里只把课程服务回的课堂状态（peerClass）、对话（turns）和同学们这次新说的话（lines）排成页面要画的样子，
// 谁学会了什么、黑板点亮哪条、谁来提问都由课程服务 lib/course/peer-class.ts 定，这里不判断。

const PEER_IDS = ['xiaoman', 'doudou', 'ale']
const PEER_NAMES = { xiaoman: '小满', doudou: '豆豆', ale: '阿乐' }
// 提示条里的「讲给他听」：小满是女孩
const PEER_PRONOUNS = { xiaoman: '她', doudou: '他', ale: '他' }

// 人物图：三人 × 四表情，素材键 peer-class/peer-<同学>-<表情>.png（scripts/ui-assets/peer-class/upload-peer-art.mjs 上架）。
// 写成完整路径，scripts/verify-ui-assets.mjs 才扫得到。
const PEER_ART = {
  xiaoman: {
    listen: '/assets/peer-class/peer-xiaoman-listen.png',
    happy: '/assets/peer-class/peer-xiaoman-happy.png',
    confused: '/assets/peer-class/peer-xiaoman-confused.png',
    ask: '/assets/peer-class/peer-xiaoman-ask.png'
  },
  doudou: {
    listen: '/assets/peer-class/peer-doudou-listen.png',
    happy: '/assets/peer-class/peer-doudou-happy.png',
    confused: '/assets/peer-class/peer-doudou-confused.png',
    ask: '/assets/peer-class/peer-doudou-ask.png'
  },
  ale: {
    listen: '/assets/peer-class/peer-ale-listen.png',
    happy: '/assets/peer-class/peer-ale-happy.png',
    confused: '/assets/peer-class/peer-ale-confused.png',
    ask: '/assets/peer-class/peer-ale-ask.png'
  }
}
const CLASSROOM_ART = '/assets/peer-class/classroom.jpg'
const DESK_ART = '/assets/peer-class/desk.png'
const STAR_ART = '/assets/quest/rating-star.svg'
const STAR_EMPTY_ART = '/assets/quest/rating-star-empty.svg'
// 名牌上最多画几颗星；要点更多时画一颗星 + 「3/6」
const MAX_STAR_ICONS = 5

const ANSWERABLE = ['not_started', 'in_progress', 'ai_retry', 'teacher_rejected']

function peerName(id) {
  return PEER_NAMES[id] || '同学'
}

/**
 * 页面处在哪一步：
 * learning 还没学完 / intro 还没开课（含正在进行的旧版问答式验收：点开始就另开一次当小老师）/
 * class 正在上课 / settling 课已经下了、结论还没落下（进页面时补一次）/ pending、passed、retry 有结论了。
 */
function viewState(acceptance = {}, peerClass = null) {
  const status = acceptance.status || 'not_started'
  if (!acceptance.learningComplete && ANSWERABLE.includes(status)) return 'learning'
  if (status === 'in_progress') {
    if (!peerClass) return 'intro'
    return peerClass.finished ? 'settling' : 'class'
  }
  if (status === 'pending_teacher') return 'pending'
  if (status === 'teacher_passed') return 'passed'
  if (status === 'ai_retry' || status === 'teacher_rejected') return 'retry'
  return 'intro'
}

/** 一句话对应的表情：学会了 / 打招呼、下课 → happy；再讲一遍、记混了 → confused；其余提问 → ask；没学会新东西 → listen。 */
function lineMood(line) {
  if (!line) return 'listen'
  if (line.kind === 'react') return Number(line.gained) > 0 ? 'happy' : 'listen'
  if (line.kind === 'ask') return askMood(line.askKind)
  if (line.kind === 'greet' || line.kind === 'bye') return 'happy'
  return 'listen'
}

function askMood(kind) {
  return kind === 'repeat' || kind === 'confused' ? 'confused' : 'ask'
}

/**
 * 一个同学现在的表情。
 * - 孩子按住说话时，所有人都在听（listen）；
 * - 这一批话里他已经说过的：按最后说的那句（lineMood）；
 * - 这一批都读完了（settled）、他是等小老师回答的提问者：保持提问时的表情；
 * - 下课出了「通过」的结论：大家举着笔记本（happy）；
 * - 其余在听。
 */
function peerMood(id, { lines = [], revealed = 0, asking = null, learnerTalking = false, settled = true, outcome = '' } = {}) {
  if (learnerTalking) return 'listen'
  if (outcome === 'passed') return 'happy'
  const said = lines.slice(0, revealed).filter((line) => line && line.peer === id)
  if (said.length) return lineMood(said[said.length - 1])
  if (settled && asking && asking.peer === id) return askMood(asking.kind)
  return 'listen'
}

/**
 * 孩子讲完一段、等同学们回应时的说法（2026-11-18 用户反馈：讲完页面干等着，看不出在做什么）。
 * 一般两三秒；等久了换一句；这是最后一段（讲满了）就说同学们在整理笔记、马上下课。与网页端 waitingText 一致。
 */
function waitingText(seconds = 0, lastRound = false) {
  if (lastRound) return seconds < 8 ? '最后一段讲完啦，同学们在整理笔记…' : '同学们在把今天学到的整理好，马上下课'
  if (seconds < 6) return '同学们在记笔记…'
  if (seconds < 15) return '同学们还在认真记，马上就回应你'
  return '同学们记得很认真，再等一下下'
}

/** 这一段讲完会不会下课：讲满最多段数了。 */
function isLastRound(peerClass) {
  return Boolean(peerClass) && (Number(peerClass.rounds) || 0) + 1 >= (Number(peerClass.maxRounds) || 0)
}

/** 提示条：等判分 → 记笔记（等久了换说法）；同学们在说 → 在说；有人提问 → 讲给他听；还没讲 → 从第一件事讲起。 */
function peerHint({ peerClass = null, playing = false, sending = false, waitSeconds = 0 } = {}) {
  if (sending) return waitingText(waitSeconds, isLastRound(peerClass))
  if (playing) return '同学们在说…'
  if (!peerClass || peerClass.finished) return ''
  const asking = peerClass.asking
  if (asking && asking.peer) {
    const peer = (peerClass.peers || []).find((item) => item.id === asking.peer)
    const name = (peer && peer.name) || peerName(asking.peer)
    return `${name}在提问，讲给${PEER_PRONOUNS[asking.peer] || '他'}听吧`
  }
  if (!peerClass.rounds) return '先从黑板第一件事讲起，讲给同学们听吧'
  return '接着讲黑板上还没讲清的事吧'
}

// 孩子半天没开口（2026-11-17 用户要求：弹出大概怎么讲的提示，降低压力）：同学们说完、轮到小老师讲，
// 15 秒没动静先弹「可以这样开头」，再过 20 秒加上这件事的大概的提示。
// 讲哪件事、开头怎么说、大概的提示都由课程服务给（peerClass.hint，lib/course/peer-class.ts peerClassHint），这里只排版。
const HINT_FIRST_DELAY = 15000
const HINT_MORE_DELAY = 20000
const HINT_REASSURE = '不用一次讲完，想到哪讲到哪，讲错了也没关系。'

/** 同一个「轮到小老师讲」的时刻：讲了新的一段（rounds 变了）或换了要讲的事，提示从头算。 */
function hintKey(peerClass) {
  if (!peerClass || peerClass.finished || !peerClass.hint) return ''
  return `${Number(peerClass.rounds) || 0}|${peerClass.hint.topic || ''}`
}

/** 提示卡。level 1：怎么开头；level 2：再加大概的提示。没有大概的提示时 level 2 和 1 一样。 */
function hintCard(peerClass, level = 1) {
  const hint = peerClass && !peerClass.finished ? peerClass.hint : null
  if (!hint || level < 1) return null
  return {
    topic: hint.topic || '',
    reassure: hint.reassure || HINT_REASSURE,
    starters: (hint.starters || []).filter(Boolean).slice(0, 3),
    cue: level >= 2 ? hint.cue || '' : '',
    canMore: level < 2 && Boolean(hint.cue)
  }
}

/** 读给孩子听的那句：安慰 + 第一句开头（去掉「……」）+ 大概的提示。onlyCue：刚加上大概的提示时只读这一句。 */
function hintSpeech(card, { onlyCue = false } = {}) {
  if (!card) return ''
  const cue = card.cue || ''
  if (onlyCue) return cue
  const start = String(card.starters[0] || '').replace(/[：:]?…+$/, '')
  return `${card.reassure}${start ? `可以这样开头：${start}。` : ''}${cue}`
}

/**
 * 气泡：每个同学最近说的那句话。lines 是 turns 末尾刚回来的这一批，还没读到的（revealed 之后）先不亮。
 * old = 这句是孩子讲最新一段之前说的（画淡一点）。
 */
function peerBubbles(turns = [], { lines = [], revealed = 0 } = {}) {
  const pending = Math.max(0, lines.length - revealed)
  const visible = turns.slice(0, Math.max(0, turns.length - pending))
  let lastLearner = -1
  visible.forEach((turn, index) => { if (turn.role === 'user') lastLearner = index })
  const bubbles = {}
  visible.forEach((turn, index) => {
    if (turn.role !== 'assistant' || !turn.speaker || turn.speaker === 'learner') return
    bubbles[turn.speaker] = { text: turn.content, old: index < lastLearner }
  })
  return bubbles
}

function starsOf(stars, total) {
  const count = Math.max(0, Number(stars) || 0)
  const all = Math.max(0, Number(total) || 0)
  if (!all) return { icons: [], text: '' }
  if (all > MAX_STAR_ICONS) return { icons: [count > 0], text: `${count}/${all}` }
  return { icons: Array.from({ length: all }, (_, index) => index < count), text: '' }
}

/** 这一批已经读到的话里，这个同学最后一句是「学会了」。 */
function saidLearned(id, lines = [], revealed = 0) {
  const said = lines.slice(0, revealed).filter((line) => line && line.peer === id)
  const last = said[said.length - 1]
  return Boolean(last && last.kind === 'react' && Number(last.gained) > 0)
}

/**
 * 教室里的一排同学。还没开课（peerClass 为 null）时按三个同学画、不画星星。
 * speakingPeer：正在出声的同学（高亮光圈 + 喇叭）。
 */
function classroomPeers({ peerClass = null, turns = [], lines = [], revealed = 0, speakingPeer = '', learnerTalking = false, playing = false, outcome = '', thinking = false } = {}) {
  const peers = peerClass && Array.isArray(peerClass.peers) && peerClass.peers.length
    ? peerClass.peers
    : PEER_IDS.map((id) => ({ id, name: peerName(id), stars: null }))
  const total = peerClass ? peerClass.total : 0
  const asking = peerClass ? peerClass.asking : null
  const bubbles = peerBubbles(turns, { lines, revealed })
  const settled = !playing && revealed >= lines.length
  return peers.filter((peer) => PEER_ART[peer.id]).map((peer) => {
    const mood = peerMood(peer.id, { lines, revealed, asking, learnerTalking, settled, outcome })
    const bubble = bubbles[peer.id] || null
    const stars = peer.stars === null || peer.stars === undefined ? { icons: [], text: '' } : starsOf(peer.stars, total)
    return {
      id: peer.id,
      name: peer.name || peerName(peer.id),
      mood: thinking ? 'listen' : mood,
      art: PEER_ART[peer.id][thinking ? 'listen' : mood],
      // 孩子讲完一段、同学们在记笔记：头上画「…」（2026-11-18）
      thinking: Boolean(thinking),
      // 这一批里刚说「学会了」的同学：头上冒星星（2026-11-18）
      sparkle: !thinking && !learnerTalking && saidLearned(peer.id, lines, revealed),
      bubble: thinking ? '' : (bubble ? bubble.text : ''),
      bubbleOld: Boolean(bubble && bubble.old && speakingPeer !== peer.id),
      speaking: speakingPeer === peer.id,
      asking: Boolean(settled && asking && asking.peer === peer.id),
      starIcons: stars.icons,
      starText: stars.text
    }
  })
}

/** 黑板：每条板书话题 done 打勾 / half 讲到一半 / todo 空圈；右上「已讲 done/total」，底下还能讲几段。 */
function boardView(peerClass) {
  if (!peerClass) return null
  const items = (peerClass.board || []).map((item, index) => ({
    id: `b${index}`,
    topic: item.topic,
    state: item.state === 'done' || item.state === 'half' ? item.state : 'todo'
  }))
  const roundsLeft = Math.max(0, (Number(peerClass.maxRounds) || 0) - (Number(peerClass.rounds) || 0))
  return { items, done: Number(peerClass.done) || 0, total: Number(peerClass.total) || items.length, roundsLeft }
}

/** 按顺序朗读的一串：每句用说话那个同学的声音。 */
function speechQueue(lines = []) {
  return lines.filter((line) => line && line.text).map((line) => ({ text: line.text, voice: line.peer }))
}

/** 课堂记录：孩子讲的和同学们说的，按顺序带名字。 */
function classRecords(turns = []) {
  return turns.map((turn, index) => {
    const learner = turn.role === 'user'
    const speaker = learner ? 'learner' : (turn.speaker || '')
    return {
      id: `r${index}`,
      learner,
      speaker,
      name: learner ? '我（小老师）' : (PEER_NAMES[speaker] || '老师'),
      text: turn.content
    }
  })
}

/**
 * 结论卡。peerClass 有就按黑板说（没讲清的板书话题），没有（以前的问答式验收）退回考官的要点。
 * 不写「不通过」「差一点」：没过关就是「还有同学没听明白」，说错的地方说成「同学们记混了」。
 */
function resultCard(state, acceptance = {}, peerClass = null) {
  const topics = acceptance.topics || []
  const peers = peerClass && Array.isArray(peerClass.peers) ? peerClass.peers : []
  const peerStars = peers.map((peer) => ({ id: peer.id, name: peer.name || peerName(peer.id), stars: Number(peer.stars) || 0 }))
  if (state === 'pending') {
    return {
      kind: 'pending',
      title: '同学们都听懂了！',
      copy: '老师再看看你这节课，确认后这节课就算通过，下面的知识点会进入你的学习宇宙。',
      peerStars,
      topicsTitle: '本课知识点',
      topics
    }
  }
  if (state === 'passed') {
    const teacher = acceptance.teacherName || '老师'
    return {
      kind: 'passed',
      title: '这节课通过啦',
      copy: `${teacher} 已确认${acceptance.teacherSummary ? '：' + acceptance.teacherSummary : '。'}`,
      peerStars,
      topicsTitle: '已进入学习宇宙',
      topics
    }
  }
  if (state === 'retry' && acceptance.status === 'teacher_rejected') {
    const summary = acceptance.teacherSummary || '回到课程再看看，准备好了再给同学们讲一次。'
    return {
      kind: 'rejected',
      title: '老师建议再巩固一下',
      copy: acceptance.teacherName ? `${acceptance.teacherName}：${summary}` : summary,
      peerStars: [],
      topicsTitle: '',
      topics: []
    }
  }
  if (state === 'retry') {
    const grade = acceptance.grade || {}
    const unclear = peerClass
      ? (peerClass.board || []).filter((item) => item.state !== 'done').map((item) => item.topic).filter(Boolean)
      : (grade.weakPoints || [])
    const misconceptions = grade.misconceptions || []
    return {
      kind: 'retry',
      title: unclear.length ? '还有同学没听明白' : '同学们还想再听你讲一次',
      copy: unclear.length ? '这几件事再讲清楚一点：' : '回课程看看，准备好了再给同学们讲一次。',
      unclear,
      misconceptions,
      peerStars,
      topicsTitle: '',
      topics: []
    }
  }
  return null
}

module.exports = {
  PEER_IDS,
  PEER_NAMES,
  PEER_ART,
  CLASSROOM_ART,
  DESK_ART,
  STAR_ART,
  STAR_EMPTY_ART,
  HINT_FIRST_DELAY,
  HINT_MORE_DELAY,
  viewState,
  hintKey,
  hintCard,
  hintSpeech,
  lineMood,
  peerMood,
  peerHint,
  waitingText,
  isLastRound,
  peerBubbles,
  classroomPeers,
  boardView,
  speechQueue,
  classRecords,
  resultCard
}
