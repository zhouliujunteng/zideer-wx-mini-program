const assert = require('node:assert/strict')
const test = require('node:test')
const {
  normalizeChallenge, emptyChallengeAnswer, challengeResponse, challengeScreen, challengeFeedback, challengePercent, challengeSummary, challengeInvite
} = require('../utils/challenge-view')
const { normalizeQuestPath, questPathView, nodeTarget, nodePopover } = require('../utils/quest-path-view')

// 考试挑战（2026-11-17）：互动练习通关后可选的一关（learning/challenge），学习页路径上画在互动练习之后。

const READY = normalizeChallenge({
  stageId: 'stage-a', title: '有理数的加法', status: 'ready', questionCount: 3,
  questions: [
    { type: 'single', prompt: '题1', point: '绝对值', options: ['甲', '乙', '丙', '丁'] },
    { type: 'fill', prompt: '较小的是 ____', point: '数轴' },
    { type: 'steps', prompt: '大题', point: '规律', steps: ['(1) 每组和', '(2) 几组', '(3) 结果'] }
  ],
  progress: { current: 2, tries: 1, solved: 1 }
})

test('multi-step questions collect one answer per step and are ready only when all are filled', () => {
  const steps = READY.questions[2]
  const empty = emptyChallengeAnswer(steps)
  assert.deepEqual(empty, ['', '', ''])
  const partly = challengeScreen(READY, ['1', '50', ''], false, [true, true, false])
  assert.equal(partly.ready, false)
  assert.equal(partly.again, true, '这道已经答过一次：标「还有一次机会」')
  assert.deepEqual(partly.steps.map((s) => s.mark), ['right', 'right', 'wrong'])
  assert.equal(challengeScreen(READY, ['1', '50', '50']).ready, true)
  assert.deepEqual(challengeResponse(steps, [' 1', '50 ', '50']), ['1', '50', '50'])
  assert.equal(challengePercent(READY), 67)
})

test('the first miss shows why and a hint but no answer; the second shows the answer', () => {
  const first = challengeFeedback({ correct: false, held: true, steps: [true, false, true], feedback: '', hint: '两两配对', answer: '', explanation: '' })
  assert.equal(first.held, true)
  assert.equal(first.action, '再试一次')
  assert.equal(first.stepNote, '第 2 问不对，其余是对的')
  assert.equal(first.hint, '两两配对')
  assert.equal(first.answer, '')
  const second = challengeFeedback({ correct: false, held: false, answer: '(1) 1；(2) 50；(3) 50', explanation: '每组和为 1', hint: 'x' })
  assert.equal(second.title, '这道没拿下')
  assert.equal(second.action, '继续')
  assert.equal(second.hint, '')
  assert.match(second.answer, /50/)
  assert.equal(challengeFeedback({ correct: true, explanation: '对' }).title, '答对了！')
})

test('the summary gives stars and what each question was about', () => {
  const done = normalizeChallenge({
    status: 'done', stars: 2, firstTryCount: 2, questionCount: 3, questions: READY.questions,
    review: [{ answer: 'A', explanation: 'e', firstTry: true, solved: true }, { answer: '-7', explanation: '', firstTry: true, solved: true }, { answer: '50', explanation: '', firstTry: false, solved: false }]
  })
  const summary = challengeSummary(done)
  assert.deepEqual(summary.stars, [true, true, false])
  assert.equal(summary.first, 2)
  assert.equal(summary.solved, 2)
  assert.equal(summary.review[0].point, '绝对值')
  assert.equal(challengeSummary(READY), null)
})

test('practice clearing invites to the challenge only when recommended, and goes straight in with challenge mode on', () => {
  assert.equal(challengeInvite(null), null)
  assert.equal(challengeInvite({ recommended: false, mode: false }), null)
  assert.equal(challengeInvite({ recommended: true, mode: false }).auto, false)
  assert.equal(challengeInvite({ recommended: false, mode: true }).auto, true)
})

test('the path puts an optional challenge right after the practice of lessons that have one', () => {
  const lesson = (stageId, practice) => ({ stageId, title: stageId, chest: { state: 'opened' }, steps: [
    { key: 'watch', state: 'done', label: '看课' },
    { key: 'practice', state: practice, label: '互动练习' },
    { key: 'accept', state: practice === 'done' ? 'current' : 'locked', label: 'AI 老师验收' }
  ] })
  const path = normalizeQuestPath({
    current: { stageId: 'stage-a', step: 'accept' },
    stats: { lessons: 2, done: 0 },
    trackId: 4,
    stages: [{ id: 's1', title: '有理数', lessons: [lesson('stage-a', 'done'), lesson('stage-b', 'done'), lesson('stage-c', 'current')] }],
    challenge: {
      mode: true,
      lessons: {
        'stage-a': { status: 'open', stars: 0, recommended: true },
        'stage-b': { status: 'done', stars: 2, recommended: false },
        'stage-x': { status: 'unavailable' }
      }
    }
  })
  assert.equal(path.challenge.mode, true)
  assert.equal(path.challenge.lessons['stage-x'], undefined)
  const view = questPathView(path)
  const kinds = (i) => view.parts[i].nodes.map((n) => n.kind)
  assert.deepEqual(kinds(0), ['step', 'lesson-chest', 'step', 'challenge', 'step', 'trophy'])
  assert.deepEqual(kinds(2), ['step', 'lesson-chest', 'step', 'step', 'trophy'], '没有挑战的课不画')
  const open = view.parts[0].nodes[3]
  assert.equal(open.glyph, '/assets/quest/bolt.svg')
  assert.equal(open.recommended, true)
  assert.notEqual(view.currentId, open.id, '挑战不当当前关')
  assert.deepEqual(nodeTarget(open), { url: '/learning/challenge/index?stageId=stage-a' })
  assert.equal(nodePopover(open).action, '开始挑战')
  const done = view.parts[1].nodes[3]
  assert.equal(done.state, 'done')
  assert.deepEqual(done.stars, [true, true, false])
  assert.equal(nodePopover(done).action, '看看题目')
  // 旧版课程服务不回 challenge：不画挑战关
  const old = questPathView(normalizeQuestPath({ ...path, challenge: undefined, stages: [{ id: 's1', title: '有理数', lessons: [lesson('stage-a', 'done')] }] }))
  assert.equal(old.parts[0].nodes.some((n) => n.kind === 'challenge'), false)
})
