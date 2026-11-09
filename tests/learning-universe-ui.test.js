const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const test = require('node:test')

test('learning universe is its own tab between learning and the goal tab', () => {
  const app = JSON.parse(readFileSync(require.resolve('../app.json'), 'utf8'))
  const paths = app.tabBar.list.map(item => item.pagePath)
  const texts = app.tabBar.list.map(item => item.text)
  const universe = readFileSync(require.resolve('../pages/knowledge-universe/index.js'), 'utf8')
  const mapTemplate = readFileSync(require.resolve('../pages/knowledge-map/index.wxml'), 'utf8')

  // 2026-10-10 起「图谱」换成「目标」，知识图谱在「我的 › 知鹿服务」
  assert.deepEqual(paths, ['pages/home/index', 'pages/learning/index', 'pages/knowledge-universe/index', 'pages/goal/index', 'pages/me/index'])
  assert.deepEqual(texts, ['首页', '学习', '宇宙', '目标', '我的'])
  assert.ok(app.pages.includes('pages/knowledge-map/index'))
  assert.ok(app.pages.includes('pages/knowledge-universe/index'))
  // Three.js 放在纯 JS 分包里异步加载，不进主包
  assert.ok(app.subpackages.some(item => item.root === 'universe' && item.pages.length === 0))
  assert.match(universe, /require\.async\('\.\.\/\.\.\/universe\/globe-renderer\.js'\)/)
  assert.doesNotMatch(universe, /mock-service/)
  assert.doesNotMatch(mapTemplate, /data-view="universe"/)
})

test('AI acceptance tells the learner when a point enters the universe', () => {
  const result = readFileSync(require.resolve('../learning/acceptance-result/index.wxml'), 'utf8')
  const entry = readFileSync(require.resolve('../learning/acceptance-entry/index.wxml'), 'utf8')

  assert.match(result, /已进入你的学习宇宙/)
  assert.match(entry, /AI 验收通过后/)
  assert.doesNotMatch(result, /智能初评不会直接形成/)
})

test('only teacher-verified or assessment-stable topics enter the universe', () => {
  global.wx = global.wx || { getStorageSync() {}, setStorageSync() {}, request() {} }
  const { buildKnowledgeUniverse } = require('../services/identity')
  const topic = (id, name) => ({ id, subject_id: 1, display_name: name, centrality: 0.1 })
  const universe = buildKnowledgeUniverse({ nickname: '小鹿', current_grade: 5 }, {
    status: 'ready',
    subjects: [{ id: 1, display_name: '数学' }],
    topics: [topic(1, '小数'), topic(2, '分数'), topic(3, '面积'), topic(4, '体积'), topic(5, '旧版AI判掌握')],
    masteries: [
      { knowledge_topic_id: 1, status: 'mastered', in_universe: true, teacher_evidence_count: 1 },
      { knowledge_topic_id: 2, status: 'assessed_stable', in_universe: true },
      { knowledge_topic_id: 3, status: 'pending_teacher', in_universe: false },
      { knowledge_topic_id: 4, status: 'reinforce' },
      // 旧版后端没有 in_universe：AI 验收直接判的「已掌握」不算，必须老师核验
      { knowledge_topic_id: 5, status: 'mastered', mastery_source: 'ai_acceptance' }
    ],
    universe: { masteredCount: 2, teacherEvidenceCount: 1 }
  }, 0)
  assert.deepEqual(universe.cards.map(card => card.name), ['小数', '分数'])
  assert.deepEqual(universe.learningOverview.map(item => item.value), ['2', '0', '1'])
})

test('universe stat line tells how many mastered topics are not on the globe', () => {
  const source = readFileSync(require.resolve('../pages/knowledge-universe/index.js'), 'utf8')
  const statText = new Function(`${source.slice(source.indexOf('function universeStatText'), source.indexOf('// 同一时间最多挂几张知识卡'))}; return universeStatText`)()
  assert.equal(statText(128, 16, false), '已掌握 128 个知识点 · 当前展示 16 个')
  assert.equal(statText(12, 12, false), '已掌握 12 个知识点，已全部展示')
  assert.equal(statText(0, 0, false), '')
  assert.equal(statText(null, 0, false), '')
  assert.equal(statText(0, 216, true), '测试数据 · 当前展示 216 个知识点')

  const { buildKnowledgeUniverse } = require('../services/identity')
  const universe = buildKnowledgeUniverse({ nickname: '小鹿' }, {
    status: 'ready', subjects: [], topics: [{ id: 1, display_name: '小数' }],
    masteries: [{ knowledge_topic_id: 1, status: 'assessed_stable', in_universe: true }],
    universe: { masteredCount: 40 }
  }, 0)
  // 总数以后端累计为准（含不在当前学期、没上球的知识点）
  assert.equal(universe.universeTotal, 40)
  assert.equal(buildKnowledgeUniverse({ nickname: '小鹿' }, null, 0).universeTotal, null)
})
