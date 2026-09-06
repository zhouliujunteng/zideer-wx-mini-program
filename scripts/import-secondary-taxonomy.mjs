import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = '/Users/zhouliujunteng/quansuxuexi'
const sourceRoot = '/Users/zhouliujunteng/Documents/kimi/tasks/2026-09-01/11-53-34-9e9501fe/secondary-zh-1.0.0'
const versionId = 2
const importBatchId = 2
const batchSize = 200

function graphql(query, variables = {}) {
  const output = execFileSync('npx', [
    '-y', 'zion-mcp@2.7.4', 'runtime', 'graphql',
    '--query', query,
    '--variables', JSON.stringify(variables)
  ], {
    cwd: projectRoot,
    env: { ...process.env, MCP_TYPE_SYSTEM: 'post' },
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  })
  const jsonStart = output.indexOf('{')
  if (jsonStart < 0) throw new Error(output)
  const result = JSON.parse(output.slice(jsonStart))
  if (result.error) throw new Error(result.error)
  return result
}

function batches(items) {
  return Array.from({ length: Math.ceil(items.length / batchSize) }, (_, index) => items.slice(index * batchSize, (index + 1) * batchSize))
}

const topics = JSON.parse(readFileSync(resolve(sourceRoot, 'topics.json'), 'utf8')).topics
const dependencies = JSON.parse(readFileSync(resolve(sourceRoot, 'dependencies.json'), 'utf8')).dependencies

const current = graphql(
  'query ExistingTaxonomy($versionId: bigint!) { knowledge_subject(where: { taxonomy_version_id: { _eq: $versionId } }) { id subject_key } knowledge_domain { id subject_id domain_key } knowledge_topic(where: { taxonomy_version_id: { _eq: $versionId } }, limit: 2000) { id topic_key } }',
  { versionId }
)
const subjects = Object.fromEntries(current.knowledge_subject.map((item) => [item.subject_key, Number(item.id)]))
const domains = new Map(current.knowledge_domain.map((item) => [`${item.subject_id}:${item.domain_key}`, Number(item.id)]))
const existingTopics = new Map(current.knowledge_topic.map((item) => [item.topic_key, Number(item.id)]))

const requiredDomains = new Map()
for (const topic of topics) {
  const subjectId = subjects[topic.subject]
  if (!subjectId) throw new Error(`Missing subject: ${topic.subject}`)
  requiredDomains.set(`${subjectId}:${topic.domain}`, { subject_id: subjectId, domain_key: topic.domain, display_name: topic.domain })
}

const missingDomains = [...requiredDomains.values()].filter((domain) => !domains.has(`${domain.subject_id}:${domain.domain_key}`))
for (const group of batches(missingDomains)) {
  graphql('mutation InsertDomains($objects: [knowledge_domain_insert_input!]!) { insert_knowledge_domain(objects: $objects) { affected_rows } }', { objects: group })
}

if (missingDomains.length) {
  const refreshed = graphql('query Domains { knowledge_domain { id subject_id domain_key } }')
  refreshed.knowledge_domain.forEach((item) => domains.set(`${item.subject_id}:${item.domain_key}`, Number(item.id)))
}

const missingTopics = topics.filter((topic) => !existingTopics.has(topic.id)).map((topic) => ({
  topic_key: topic.id,
  display_name: topic.name,
  description: topic.description,
  topic_type: topic.type,
  node_kind: topic.nodeKind,
  school_stage: topic.stage,
  grade_start: topic.ageRangeStart - 5,
  grade_end: topic.ageRangeEnd - 5,
  age_start: topic.ageRangeStart,
  age_end: topic.ageRangeEnd,
  centrality: topic.centrality,
  evidence: topic.evidence,
  assessment_prompt: topic.assessmentPrompt,
  origin_type: topic.origin,
  content_status: 'published',
  source_hash: createHash('sha256').update(JSON.stringify(topic)).digest('hex'),
  taxonomy_version_id: versionId,
  subject_id: subjects[topic.subject],
  domain_id: domains.get(`${subjects[topic.subject]}:${topic.domain}`),
  import_batch_id: importBatchId
}))

for (const group of batches(missingTopics)) {
  graphql('mutation InsertTopics($objects: [knowledge_topic_insert_input!]!) { insert_knowledge_topic(objects: $objects) { affected_rows } }', { objects: group })
}

const allTopics = graphql('query ImportedTopics($versionId: bigint!) { knowledge_topic(where: { taxonomy_version_id: { _eq: $versionId } }, limit: 2000) { id topic_key } }', { versionId })
const topicIds = new Map(allTopics.knowledge_topic.map((item) => [item.topic_key, Number(item.id)]))
const unresolved = dependencies.filter((edge) => !topicIds.has(edge.topicId) || !topicIds.has(edge.prerequisiteId))
if (unresolved.length) throw new Error(`Unresolved dependencies: ${unresolved.length}`)

const existingDependencies = graphql('query ExistingDependencies($batchId: bigint!) { knowledge_dependency(where: { import_batch_id: { _eq: $batchId } }, limit: 3000) { prerequisite_topic_id dependent_topic_id } }', { batchId: importBatchId })
const dependencyKeys = new Set(existingDependencies.knowledge_dependency.map((item) => `${item.prerequisite_topic_id}:${item.dependent_topic_id}`))
const missingDependencies = dependencies
  .map((edge) => ({
    edge_key: `${edge.prerequisiteId}->${edge.topicId}`,
    strength: edge.strength,
    reason: edge.reason,
    review_status: 'reviewed',
    review_provenance: edge.reviewProvenance || 'kimi_cluster',
    review_note: null,
    generation_batch_key: 'kimi-secondary-zh-1.0.0',
    import_batch_id: importBatchId,
    prerequisite_topic_id: topicIds.get(edge.prerequisiteId),
    dependent_topic_id: topicIds.get(edge.topicId)
  }))
  .filter((edge) => !dependencyKeys.has(`${edge.prerequisite_topic_id}:${edge.dependent_topic_id}`))

for (const group of batches(missingDependencies)) {
  graphql('mutation InsertDependencies($objects: [knowledge_dependency_insert_input!]!) { insert_knowledge_dependency(objects: $objects) { affected_rows } }', { objects: group })
}

graphql('mutation PublishImportedTopics($batchId: bigint!) { update_knowledge_topic(where: { import_batch_id: { _eq: $batchId } }, _set: { content_status: "published" }) { affected_rows } }', { batchId: importBatchId })

console.log(JSON.stringify({
  insertedDomains: missingDomains.length,
  insertedTopics: missingTopics.length,
  insertedDependencies: missingDependencies.length,
  totalTopics: topicIds.size
}))
