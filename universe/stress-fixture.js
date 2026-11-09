// 宇宙页压力测试数据：200 个球面知识点 + 16 个星环知识点，只在开发版（envVersion === 'develop'）
// 由 pages/knowledge-universe 加载，体验版与正式版不会用到。关掉：把页面里的 UNIVERSE_STRESS_TEST 改成 false。
const SUBJECTS = {
  数学: ['小数的意义', '分数的初步认识', '面积的计算', '图形的认识', '小数乘法', '长度单位换算', '数量关系', '因数与倍数', '方程初步', '比和比例', '圆的周长', '统计图表', '长方体体积', '平行四边形', '三角形内角和', '百分数应用', '负数', '运算定律', '简便计算', '可能性'],
  语文: ['句子表达', '修辞手法', '古诗默写', '文言虚词', '标点符号', '近义词辨析', '段落结构', '人物描写', '说明方法', '议论文论点', '成语积累', '病句修改', '作文开头', '仿写句子', '缩写扩写'],
  英语: ['一般现在时', '现在进行时', '一般过去时', '名词复数', '人称代词', '介词短语', '形容词比较级', '情态动词', '疑问句', '阅读主旨', '完形填空', '书面表达'],
  阅读: ['提取关键信息', '概括段落大意', '推断作者意图', '理解词语含义', '分析人物形象', '把握文章结构'],
  科学: ['观察与记录', '天气与变化', '植物的生长', '物质的状态', '简单电路', '光的传播', '声音的产生', '力与运动', '岩石与土壤', '太阳系']
}
const STATUSES = [
  { status: 'mastered', statusText: '已掌握' },
  { status: 'learning', statusText: '学习中' },
  { status: 'pending', statusText: '待探索' }
]

function buildTopics(count, prefix) {
  const names = []
  Object.keys(SUBJECTS).forEach((subject) => SUBJECTS[subject].forEach((name) => names.push({ subject, name })))
  const topics = []
  for (let index = 0; index < count; index += 1) {
    const base = names[index % names.length]
    const round = Math.floor(index / names.length)
    topics.push({
      id: `${prefix}-${index}`,
      name: round ? `${base.name}（${round + 1}）` : base.name,
      subject: base.subject,
      // 大致 3:4:3 的已掌握 / 学习中 / 待探索
      ...STATUSES[(index * 7) % 10 < 3 ? 0 : (index * 7) % 10 < 7 ? 1 : 2]
    })
  }
  return topics
}

function buildStressCards(globeCount = 200, ringCount = 16) {
  // 斐波那契球面格点：点在球面上均匀铺开，纬度限制在 ±72° 以内避开两极。
  const golden = Math.PI * (3 - Math.sqrt(5))
  const knowledgeCards = buildTopics(globeCount, 'stress').map((topic, index) => {
    const y = 1 - (index + 0.5) / globeCount * 2
    const latitude = Math.asin(y) * 180 / Math.PI * 0.8
    const longitude = ((index * golden * 180 / Math.PI) % 360 + 360) % 360
    return { ...topic, latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) }
  })
  const ringCards = buildTopics(ringCount, 'stress-ring').map((topic, index) => ({
    ...topic,
    angle: Number((index * 360 / ringCount + 8).toFixed(2)),
    radius: Number((2.62 + (index % 4) * 0.28).toFixed(2))
  }))
  return { knowledgeCards, ringCards }
}

module.exports = { buildStressCards }
