const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PEER_ART,
  viewState,
  lineMood,
  peerMood,
  peerHint,
  peerBubbles,
  classroomPeers,
  boardView,
  speechQueue,
  classRecords,
  resultCard
} = require('../utils/peer-class-view')

// 当小老师（2026-11-17，docs/当小老师记录.md）：同学们的表情、气泡、提示条、黑板、结论卡都由课堂状态排出来。

const PEERS3 = [
  { id: 'xiaoman', name: '小满', level: 'good', stars: 2 },
  { id: 'doudou', name: '豆豆', level: 'medium', stars: 1 },
  { id: 'ale', name: '阿乐', level: 'weak', stars: 0 }
]

function peerClass(extra = {}) {
  return {
    peers: PEERS3,
    board: [{ topic: '什么是约分', state: 'done' }, { topic: '怎样找公因数', state: 'half' }, { topic: '什么是最简分数', state: 'todo' }],
    done: 1,
    total: 3,
    rounds: 1,
    maxRounds: 8,
    asking: { peer: 'doudou', kind: 'deeper', topic: '怎样找公因数' },
    finished: false,
    ...extra
  }
}

test('each line picks its expression: learned → happy, repeat/confused → confused, other asks → ask', () => {
  assert.equal(lineMood({ kind: 'react', gained: 1 }), 'happy')
  assert.equal(lineMood({ kind: 'react', gained: 0 }), 'listen')
  assert.equal(lineMood({ kind: 'ask', askKind: 'repeat' }), 'confused')
  assert.equal(lineMood({ kind: 'ask', askKind: 'confused' }), 'confused')
  assert.equal(lineMood({ kind: 'ask', askKind: 'next' }), 'ask')
  assert.equal(lineMood({ kind: 'ask', askKind: 'deeper' }), 'ask')
  assert.equal(lineMood({ kind: 'greet' }), 'happy')
  assert.equal(lineMood({ kind: 'bye' }), 'happy')
})

test('a peer keeps the face of what he said last, the waiting asker keeps asking, everyone listens while the teacher talks', () => {
  const lines = [
    { peer: 'xiaoman', kind: 'react', gained: 1, text: '学会了' },
    { peer: 'doudou', kind: 'react', gained: 0, text: '嗯' },
    { peer: 'doudou', kind: 'ask', askKind: 'deeper', text: '为什么？' }
  ]
  const asking = { peer: 'doudou', kind: 'deeper' }
  assert.equal(peerMood('xiaoman', { lines, revealed: 1, asking, settled: false }), 'happy')
  assert.equal(peerMood('doudou', { lines, revealed: 2, asking, settled: false }), 'listen', '还没读到他的提问')
  assert.equal(peerMood('doudou', { lines, revealed: 3, asking, settled: true }), 'ask')
  assert.equal(peerMood('ale', { lines, revealed: 3, asking, settled: true }), 'listen')
  // 进页面时没有新说的话：等小老师回答的提问者举着手，阿乐记混时挠头
  assert.equal(peerMood('doudou', { asking, settled: true }), 'ask')
  assert.equal(peerMood('ale', { asking: { peer: 'ale', kind: 'confused' }, settled: true }), 'confused')
  assert.equal(peerMood('doudou', { lines, revealed: 3, asking, learnerTalking: true }), 'listen', '小老师开口时都在听')
  assert.equal(peerMood('ale', { outcome: 'passed' }), 'happy', '过关后大家举着笔记本')
})

test('the hint follows the class: grading, talking, someone asking, or start from the first thing', () => {
  assert.equal(peerHint({ peerClass: peerClass({ rounds: 0, asking: null }) }), '先从黑板第一件事讲起，讲给同学们听吧')
  assert.equal(peerHint({ peerClass: peerClass() }), '豆豆在提问，讲给他听吧')
  assert.equal(peerHint({ peerClass: peerClass({ asking: { peer: 'xiaoman', kind: 'next', topic: '' } }) }), '小满在提问，讲给她听吧')
  assert.equal(peerHint({ peerClass: peerClass(), playing: true }), '同学们在说…')
  assert.equal(peerHint({ peerClass: peerClass(), sending: true }), '同学们在记笔记…')
  assert.equal(peerHint({ peerClass: peerClass({ finished: true }) }), '')
})

test('bubbles show what each peer said last and hold back the lines not read out yet', () => {
  const turns = [
    { role: 'assistant', speaker: 'xiaoman', content: '小老师好' },
    { role: 'assistant', speaker: 'doudou', content: '今天讲什么呀' },
    { role: 'user', speaker: 'learner', content: '约分就是……' },
    { role: 'assistant', speaker: 'xiaoman', content: '我学会了约分' },
    { role: 'assistant', speaker: 'doudou', content: '为什么大小不变？' }
  ]
  const lines = [{ peer: 'xiaoman', text: '我学会了约分' }, { peer: 'doudou', text: '为什么大小不变？' }]
  const early = peerBubbles(turns, { lines, revealed: 1 })
  assert.equal(early.xiaoman.text, '我学会了约分')
  assert.equal(early.xiaoman.old, false)
  assert.equal(early.doudou.text, '今天讲什么呀', '还没读到的那句先不亮')
  assert.equal(early.doudou.old, true, '小老师讲这一段之前说的画淡')
  assert.equal(peerBubbles(turns, { lines, revealed: 2 }).doudou.text, '为什么大小不变？')
})

test('the classroom adapts to two peers for the youngest grades and draws stars of the board total', () => {
  const two = peerClass({ peers: PEERS3.slice(0, 2), asking: null })
  const peers = classroomPeers({ peerClass: two, turns: [] })
  assert.deepEqual(peers.map((peer) => peer.id), ['xiaoman', 'doudou'])
  assert.deepEqual(peers[0].starIcons, [true, true, false])
  assert.equal(peers[0].art, PEER_ART.xiaoman.listen)
  // 还没开课：三个同学、不画星星
  const before = classroomPeers({ peerClass: null })
  assert.deepEqual(before.map((peer) => peer.name), ['小满', '豆豆', '阿乐'])
  assert.deepEqual(before[0].starIcons, [])
  // 要点多时画一颗星 + 数字
  const many = classroomPeers({ peerClass: peerClass({ total: 7 }) })
  assert.deepEqual(many[0].starIcons, [true])
  assert.equal(many[0].starText, '2/7')
  // 正在出声的高亮，等回答的提问者在全部读完后标出来
  const lines = [{ peer: 'doudou', kind: 'ask', askKind: 'deeper', text: '为什么？' }]
  const speaking = classroomPeers({ peerClass: peerClass(), lines, revealed: 1, speakingPeer: 'doudou', playing: true })
  assert.equal(speaking[1].speaking, true)
  assert.equal(speaking[1].asking, false)
  assert.equal(speaking[1].art, PEER_ART.doudou.ask)
  const settled = classroomPeers({ peerClass: peerClass(), lines, revealed: 1 })
  assert.equal(settled[1].asking, true)
})

test('every peer art path is a backend asset key under peer-class/', () => {
  for (const id of ['xiaoman', 'doudou', 'ale']) {
    for (const mood of ['listen', 'happy', 'confused', 'ask']) {
      assert.equal(PEER_ART[id][mood], `/assets/peer-class/peer-${id}-${mood}.png`)
    }
  }
})

test('the board lights done, half and todo, and counts the rounds left', () => {
  const board = boardView(peerClass({ rounds: 3 }))
  assert.deepEqual(board.items.map((item) => item.state), ['done', 'half', 'todo'])
  assert.equal(board.done, 1)
  assert.equal(board.total, 3)
  assert.equal(board.roundsLeft, 5)
  assert.equal(boardView(null), null)
})

test('lines are read in order, each in the voice of the peer who says it', () => {
  assert.deepEqual(speechQueue([{ peer: 'xiaoman', text: '你好' }, { peer: 'ale', text: '' }, { peer: 'ale', text: '讲慢点' }]), [
    { text: '你好', voice: 'xiaoman' },
    { text: '讲慢点', voice: 'ale' }
  ])
})

test('the class record names who said what', () => {
  const records = classRecords([{ role: 'assistant', speaker: 'doudou', content: '为什么？' }, { role: 'user', content: '因为……' }])
  assert.deepEqual(records.map((item) => item.name), ['豆豆', '我（小老师）'])
  assert.equal(records[1].learner, true)
})

test('view states: still learning, intro (also an old Q&A in progress), in class, settling, verdicts', () => {
  assert.equal(viewState({ status: 'not_started', learningComplete: false }), 'learning')
  assert.equal(viewState({ status: 'not_started', learningComplete: true }), 'intro')
  assert.equal(viewState({ status: 'in_progress', learningComplete: true }, null), 'intro')
  assert.equal(viewState({ status: 'in_progress', learningComplete: true }, peerClass()), 'class')
  assert.equal(viewState({ status: 'in_progress', learningComplete: true }, peerClass({ finished: true })), 'settling')
  assert.equal(viewState({ status: 'pending_teacher', learningComplete: true }), 'pending')
  assert.equal(viewState({ status: 'teacher_passed', learningComplete: true }), 'passed')
  assert.equal(viewState({ status: 'ai_retry', learningComplete: true }), 'retry')
  assert.equal(viewState({ status: 'teacher_rejected', learningComplete: true }), 'retry')
})

test('a pass reads as everyone understood, with each peer\'s stars', () => {
  const card = resultCard('pending', { status: 'pending_teacher', topics: [{ name: '约分' }] }, peerClass({ finished: true }))
  assert.equal(card.title, '同学们都听懂了！')
  assert.match(card.copy, /老师再看看你这节课/)
  assert.deepEqual(card.peerStars.map((peer) => `${peer.name}${peer.stars}`), ['小满2', '豆豆1', '阿乐0'])
})

test('not passing never says failed: it names the board topics a classmate still missed, mixups are said gently', () => {
  const acceptance = { status: 'ai_retry', grade: { weakPoints: ['写给考官的要点'], misconceptions: ['把约分说成了通分'] } }
  const card = resultCard('retry', acceptance, peerClass({ finished: true }))
  assert.equal(card.title, '还有同学没听明白')
  assert.deepEqual(card.unclear, ['怎样找公因数', '什么是最简分数'])
  assert.deepEqual(card.misconceptions, ['把约分说成了通分'])
  assert.doesNotMatch(JSON.stringify(card), /不通过|差一点/)
  // 以前的问答式验收没有黑板：退回考官没讲清的要点
  assert.deepEqual(resultCard('retry', acceptance, null).unclear, ['写给考官的要点'])
  // 老师要求重学照旧显示老师的话
  const rejected = resultCard('retry', { status: 'teacher_rejected', teacherName: '王老师', teacherSummary: '再复习一下' }, null)
  assert.equal(rejected.title, '老师建议再巩固一下')
  assert.equal(rejected.copy, '王老师：再复习一下')
})

test('hint card: how to start first, the memory prompt only on the second level, and what gets read aloud', () => {
  const { hintKey, hintCard, hintSpeech } = require('../utils/peer-class-view')
  const peerClass = {
    rounds: 2,
    finished: false,
    hint: { topic: '约分后大小变不变', starters: ['我再补充一点：……', '为什么呢？因为……'], cue: '想想课上那块披萨', reassure: '' }
  }
  assert.equal(hintKey(peerClass), '2|约分后大小变不变')
  assert.equal(hintKey({ ...peerClass, finished: true }), '')
  assert.equal(hintKey({ rounds: 0, hint: null }), '')
  const first = hintCard(peerClass, 1)
  assert.equal(first.cue, '')
  assert.equal(first.canMore, true)
  assert.match(first.reassure, /讲错了也没关系/)
  assert.equal(hintSpeech(first), `${first.reassure}可以这样开头：我再补充一点。`)
  const second = hintCard(peerClass, 2)
  assert.equal(second.cue, '想想课上那块披萨')
  assert.equal(second.canMore, false)
  assert.equal(hintSpeech(second, { onlyCue: true }), '想想课上那块披萨')
  assert.equal(hintCard({ ...peerClass, hint: { ...peerClass.hint, cue: '' } }, 1).canMore, false)
  assert.equal(hintCard(null, 1), null)
})

test('waiting for the peers says they are taking notes, changes its words when it takes long, and calls the last segment', () => {
  const { waitingText, isLastRound, peerHint, classroomPeers } = require('../utils/peer-class-view')
  assert.equal(waitingText(1, false), '同学们在记笔记…')
  assert.equal(waitingText(8, false), '同学们还在认真记，马上就回应你')
  assert.equal(waitingText(20, false), '同学们记得很认真，再等一下下')
  assert.equal(waitingText(2, true), '最后一段讲完啦，同学们在整理笔记…')
  assert.equal(waitingText(10, true), '同学们在把今天学到的整理好，马上下课')
  assert.equal(isLastRound({ rounds: 7, maxRounds: 8 }), true)
  assert.equal(isLastRound({ rounds: 3, maxRounds: 8 }), false)
  assert.equal(peerHint({ peerClass: { rounds: 7, maxRounds: 8 }, sending: true, waitSeconds: 1 }), '最后一段讲完啦，同学们在整理笔记…')
  const peers = classroomPeers({
    peerClass: { peers: [{ id: 'xiaoman', name: '小满', stars: 1 }], total: 2, asking: { peer: 'xiaoman', kind: 'next' } },
    turns: [{ role: 'assistant', content: '小老师好', speaker: 'xiaoman' }],
    thinking: true
  })
  assert.equal(peers[0].thinking, true)
  assert.equal(peers[0].bubble, '')
  assert.equal(peers[0].mood, 'listen')
})
