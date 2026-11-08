#!/usr/bin/env node
// 生成图谱页的示例图谱数据 data/knowledge-map-sample.js（背景见 utils/knowledge-map-sample.js）。
//
//   node scripts/build-knowledge-map-sample.mjs
//
// 知识点名称、说明、掌握标准与先修关系取自官网知识星河 website/galaxy（与正式知识库同源：
// bewho/China-K12-knowledge-taxonomy），范围是初一（七年级）上学期；掌握状态是按顺序编的示例，
// 前面的章节学得多、后面的还没测，让示例图谱几种状态都有。官网数据更新后重跑本脚本即可。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const galaxyDir = path.join(root, '..', 'website', 'galaxy')
const outFile = path.join(root, 'data', 'knowledge-map-sample.js')

const GRADE = 7
const TERM = '上册'
// 学科代码、显示名、最多收几个知识点（按教材顺序取前 N 个；主包体积有限，数学全收，其余取前几个单元）
const SUBJECTS = [
  { code: 'math', name: '数学', limit: 48 },
  { code: 'eng', name: '英语', limit: 24 },
  { code: 'bio', name: '生物', limit: 16 }
]

// 按知识点在本学科里的先后位置编掌握状态（状态键与 services/identity.js graphStatus 的键一致）
const LEARNING_CYCLE = ['weak', 'learning', 'pending_teacher', 'assessed_stable']
function statusAt(index, total) {
  const position = total > 1 ? index / (total - 1) : 0
  if (position < 0.25) return index % 3 === 2 ? 'assessed_stable' : 'mastered'
  if (position < 0.42) return LEARNING_CYCLE[index % LEARNING_CYCLE.length]
  if (position < 0.55) return 'provisional'
  return 'unknown'
}

const graph = JSON.parse(fs.readFileSync(path.join(galaxyDir, 'graph.json'), 'utf8'))
const [TYPE_CLUSTER, TYPE_KP] = [1, 2]
const subjectIndex = new Map(graph.subjects.map((subject, index) => [subject.code, index]))

// 知识点 → 所属单元（hier 边：单元 → 知识点）
const parentOf = new Map()
for (let i = 0; i < graph.hier.length; i += 2) {
  const [from, to] = [graph.hier[i], graph.hier[i + 1]]
  if (graph.nodes[from][0] === TYPE_CLUSTER && graph.nodes[to][0] === TYPE_KP) parentOf.set(to, from)
}

const subjects = SUBJECTS.map(({ code, name, limit }) => {
  if (!subjectIndex.has(code)) throw new Error(`知识星河里没有学科 ${code}`)
  const detail = JSON.parse(fs.readFileSync(path.join(galaxyDir, 'detail', `${code}.json`), 'utf8'))
  const picked = []
  graph.nodes.forEach((node, index) => {
    const unit = graph.nodes[parentOf.get(index)]
    if (node[0] !== TYPE_KP || node[2] !== subjectIndex.get(code) || node[3] !== GRADE) return
    if (!unit || !String(unit[6] || '').includes(TERM)) return
    picked.push(index)
  })
  const kept = picked.slice(0, limit)
  if (kept.length < 8) throw new Error(`${name}只找到 ${kept.length} 个知识点，检查知识星河数据`)
  const position = new Map(kept.map((graphIndex, index) => [graphIndex, index]))
  const topics = kept.map((graphIndex, index) => {
    const [description = '', standard = ''] = detail[graphIndex] || []
    return [`sample-${code}-${index + 1}`, graph.nodes[graphIndex][1], graph.nodes[parentOf.get(graphIndex)][1], statusAt(index, kept.length), description, standard]
  })
  const edges = []
  for (let i = 0; i < graph.pre.length; i += 2) {
    const [from, to] = [position.get(graph.pre[i]), position.get(graph.pre[i + 1])]
    if (from !== undefined && to !== undefined) edges.push([from, to])
  }
  return { key: code, name, topics, edges }
})

const header = `// 自动生成，请勿手改：node scripts/build-knowledge-map-sample.mjs
// 图谱页给游客、没完善学习资料的账号看的示例图谱（见 utils/knowledge-map-sample.js）。
// 知识点与先修关系取自官网知识星河（${graph.source.name}），初一上学期；掌握状态是编的示例。
// topics：[id, 名称, 单元, 掌握状态, 知识说明, 掌握标准]；edges：[先修知识点序号, 后继知识点序号]
`
// 一个知识点一行，体积小、改动好比对（这份数据打在主包里）
const subjectBlock = (subject) => `    {\n      key: ${JSON.stringify(subject.key)}, name: ${JSON.stringify(subject.name)},\n      topics: [\n${subject.topics.map((topic) => `        ${JSON.stringify(topic)}`).join(',\n')}\n      ],\n      edges: ${JSON.stringify(subject.edges)}\n    }`
const body = `module.exports = {\n  grade: ${GRADE}, semester: '上学期',\n  subjects: [\n${subjects.map(subjectBlock).join(',\n')}\n  ]\n}\n`
fs.writeFileSync(outFile, header + body)
const summary = subjects.map((subject) => `${subject.name} ${subject.topics.length} 个知识点 / ${subject.edges.length} 条先修`).join('，')
console.log(`${path.relative(root, outFile)}  ${(fs.statSync(outFile).size / 1024).toFixed(1)} KB（${summary}）`)
