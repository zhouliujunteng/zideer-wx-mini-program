const { loadCourseOutline, saveCourseOutline, cancelCourseOutline } = require('../../services/identity')
const types = { slide: '讲解课件', quiz: '练习', interactive: '互动内容', pbl: '项目实践' }
const typeValues = Object.keys(types)
const widgets = [ 'simulation', 'diagram', 'code', 'game', 'visualization3d' ]
const widgetNames = [ '模拟实验', '交互图解', '代码练习', '互动游戏', '三维可视化' ]
function viewChapter(item) {
  const quiz = item.quizConfig || { questionCount: 3, difficulty: 'medium', questionTypes: ['single'] }
  return { ...item, typeLabel: types[item.type] || '章节', typeIndex: typeValues.indexOf(item.type),
    keyPointsText: (item.keyPoints || []).join('\n'),
    questionCount: quiz.questionCount, difficultyIndex: ['easy', 'medium', 'hard'].indexOf(quiz.difficulty),
    questionOptions: ['single', 'multiple', 'text'].map((value, index) => ({ value, label: ['单选', '多选', '简答'][index], checked: quiz.questionTypes.includes(value) })),
    widgetNames: item.widgetType === 'procedural-skill' ? [...widgetNames, '技能实训'] : widgetNames,
    widgetIndex: item.widgetType === 'procedural-skill' ? 5 : Math.max(0, widgets.indexOf(item.widgetType)),
    concept: item.widgetOutline && item.widgetOutline.concept || '',
    targetSkillsText: (item.pblConfig && item.pblConfig.targetSkills || []).join('\n'),
  }
}
function viewDraft(draft) { return { ...draft, outlines: draft.outlines.map(viewChapter) } }
Page({
  data: { loading: true, failed: false, saving: false, dirty: false, draft: null, errorMessage: '', completed: false, stopped: false, typeNames: Object.values(types), difficultyNames: ['简单', '中等', '困难'] },
  onLoad(options = {}) { this.courseInstanceId = String(options.courseInstanceId || ''); this._active = true; return this.loadPage() },
  onShow() { this._active = true; if (this._hiddenWhileLoading) { this._hiddenWhileLoading = false; return this.loadPage() } },
  onHide() { this._active = false; this._hiddenWhileLoading = this.data.loading },
  onUnload() { this._active = false; this._version = (this._version || 0) + 1 },
  async loadPage() {
    if (this.data.saving) return
    const version = this._version = (this._version || 0) + 1
    this.setData({ loading: true, failed: false, errorMessage: '' })
    try {
      const value = await loadCourseOutline(this.courseInstanceId)
      if (!this._active || version !== this._version) return
      if (!value.outlineDraft) throw new Error('大纲还在准备中，请稍后刷新。')
      this.setData({ draft: viewDraft(value.outlineDraft), completed: Boolean(value.outlineDraft.confirmedAt), stopped: value.status === 'failed', dirty: false })
      this.protectEdits(false)
    } catch (error) {
      if (this._active && version === this._version) this.setData({ failed: true, errorMessage: error.message || '大纲读取失败' })
    } finally { if (this._active && version === this._version) this.setData({ loading: false }) }
  },
  protectEdits(dirty) {
    if (dirty && wx.enableAlertBeforeUnload) wx.enableAlertBeforeUnload({ message: '大纲尚未保存，离开后修改可能丢失。' })
    if (!dirty && wx.disableAlertBeforeUnload) wx.disableAlertBeforeUnload()
  },
  change(draft) {
    if (this.data.saving || this.data.completed || this.data.stopped) return
    this.setData({ draft, dirty: true, errorMessage: '' }); this.protectEdits(true)
  },
  updateTitle(event) { if (this.data.draft) this.change({ ...this.data.draft, title: event.detail.value }) },
  updateChapter(event) {
    const { id, field } = event.currentTarget.dataset
    if (!this.data.draft || !['title', 'description', 'keyPointsText'].includes(field)) return
    const outlines = this.data.draft.outlines.map(item => item.id !== id ? item : { ...item, [field]: event.detail.value,
      ...(field === 'keyPointsText' ? { keyPoints: event.detail.value.split('\n').map(value => value.trim()).filter(Boolean) } : {}) })
    this.change({ ...this.data.draft, outlines })
  },
  changeType(event) {
    if (!this.data.draft) return
    const type = typeValues[Number(event.detail.value)]
    if (!type) return
    this.change({ ...this.data.draft, outlines: this.data.draft.outlines.map(item => {
      if (item.id !== event.currentTarget.dataset.id || item.type === type) return item
      const { quizConfig, widgetType, widgetOutline, interactiveConfig, pblConfig, editorConfig, ...base } = item
      const next = { ...base, type }
      if (type === 'quiz') next.quizConfig = { questionCount: 3, difficulty: 'medium', questionTypes: ['single'] }
      if (type === 'interactive') { next.widgetType = 'simulation'; next.widgetOutline = { concept: item.title } }
      if (type === 'pbl') next.pblConfig = { projectTopic: item.title, projectDescription: item.description, targetSkills: [...new Set(item.keyPoints || [])].slice(0, 6) }
      next.editorConfig = type === 'quiz' ? { quizConfig: next.quizConfig } : type === 'interactive' ? { widgetType: 'simulation', concept: item.title } : type === 'pbl' ? { pblConfig: next.pblConfig } : undefined
      return viewChapter(next)
    }) })
  },
  updateConfig(event) {
    if (!this.data.draft) return
    const { id, field } = event.currentTarget.dataset
    this.change({ ...this.data.draft, outlines: this.data.draft.outlines.map(item => {
      if (item.id !== id) return item
      const next = { ...item, editorConfig: { ...item.editorConfig } }, value = event.detail.value
      if (item.type === 'quiz') {
        const config = { ...(item.quizConfig || { questionCount: 3, difficulty: 'medium', questionTypes: ['single'] }) }
        if (field === 'questionCount') config.questionCount = Math.min(10, Math.max(1, Number(value) || 1))
        else if (field === 'difficulty') config.difficulty = ['easy', 'medium', 'hard'][Number(value)] || 'medium'
        else if (field === 'questionTypes') { if (!value.length) return item; config.questionTypes = value }
        else return item
        next.quizConfig = config; next.editorConfig.quizConfig = config
      } else if (item.type === 'interactive') {
        if (field === 'widgetType') {
          const kind = [...widgets, ...(item.widgetType === 'procedural-skill' ? ['procedural-skill'] : [])][Number(value)]
          if (!kind || kind === item.widgetType) return item
          next.widgetType = kind; next.widgetOutline = { concept: item.concept }
        } else if (field === 'concept') next.widgetOutline = { ...item.widgetOutline, concept: value }
        else return item
        next.editorConfig = { widgetType: next.widgetType || 'simulation', concept: next.widgetOutline.concept }
      } else if (item.type === 'pbl') {
        const config = { ...(item.pblConfig || { projectTopic: '', projectDescription: '', targetSkills: [] }) }
        if (['projectTopic', 'projectDescription', 'scenarioBrief'].includes(field)) config[field] = value
        else if (field === 'targetSkills') config.targetSkills = [...new Set(value.split('\n').map(text => text.trim()).filter(Boolean))]
        else if (field === 'scenarioRoleplay') { config.scenarioRoleplay = Boolean(value); if (value) config.scenarioBrief = config.scenarioBrief || config.projectDescription || item.description || item.title }
        else return item
        if (!config.scenarioRoleplay) { delete config.scenarioRoleplay; delete config.scenarioBrief }
        next.pblConfig = config
        next.editorConfig.pblConfig = { projectTopic: config.projectTopic, projectDescription: config.projectDescription, targetSkills: config.targetSkills,
          ...(config.scenarioRoleplay ? { scenarioRoleplay: true, scenarioBrief: config.scenarioBrief || '' } : {}) }
      } else return item
      return { ...viewChapter(next), ...(field === 'targetSkills' ? { targetSkillsText: value } : {}) }
    }) })
  },
  selectMode(event) { const mode = event.currentTarget.dataset.mode; if (this.data.draft && ['ppt', 'course'].includes(mode)) this.change({ ...this.data.draft, mode }) },
  moveChapter(event) {
    if (!this.data.draft) return
    const { id, direction } = event.currentTarget.dataset
    const list = this.data.draft.outlines.slice(), index = list.findIndex(item => item.id === id), target = index + Number(direction)
    if (index < 0 || ![-1, 1].includes(Number(direction)) || target < 0 || target >= list.length) return
    ;[list[index], list[target]] = [list[target], list[index]]
    this.change({ ...this.data.draft, outlines: list.map((item, i) => ({ ...item, order: i + 1 })) })
  },
  removeChapter(event) {
    if (!this.data.draft || this.data.draft.outlines.length <= 1) return
    this.change({ ...this.data.draft, outlines: this.data.draft.outlines.filter(item => item.id !== event.currentTarget.dataset.id).map((item, index) => ({ ...item, order: index + 1 })) })
  },
  addChapter() {
    if (!this.data.draft || this.data.draft.outlines.length >= 50) return
    const item = { id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, type: 'slide', typeLabel: '讲解课件', title: '', description: '', keyPoints: [], keyPointsText: '', order: this.data.draft.outlines.length + 1 }
    this.change({ ...this.data.draft, outlines: [...this.data.draft.outlines, item] })
  },
  async persist(confirm) {
    if (!this.data.draft || this.data.saving || this.data.completed || this.data.stopped) return
    const draft = this.data.draft
    if (!draft.title.trim() || !draft.outlines.length || draft.outlines.some(item => !item.title.trim())) {
      this.setData({ errorMessage: '请填写课程标题和每一章的标题。' }); return
    }
    this.setData({ saving: true, errorMessage: '' })
    const version = this._version
    try {
      const saved = await saveCourseOutline(this.courseInstanceId, draft, confirm)
      if (version !== this._version) return
      this.setData({ draft: viewDraft(saved.outlineDraft), dirty: false, completed: Boolean(saved.outlineDraft.confirmedAt) })
      this.protectEdits(false)
      if (this._active) wx.showToast({ title: confirm ? '已确认，正在生成课程' : '大纲已保存', icon: 'none' })
    } catch (error) {
      if (version === this._version) this.setData({ errorMessage: error.message || '大纲保存失败，请重试。' })
    } finally { if (version === this._version) this.setData({ saving: false }) }
  },
  saveDraft() { return this.persist(false) },
  confirmGeneration() { return this.persist(true) },
  cancelGeneration() {
    if (this.data.saving || this.data.completed || this.data.stopped) return
    wx.showModal({ title: '取消本次课程？', content: '停止本次生成并按原有失败释放流程退回冻结积分。', confirmText: '取消课程', success: async result => {
      if (!result.confirm || !this._active || this.data.saving) return
      const version = this._version
      this.setData({ saving: true })
      try {
        await cancelCourseOutline(this.courseInstanceId)
        if (version !== this._version) return
        this.setData({ stopped: true, dirty: false }); this.protectEdits(false)
        if (this._active) this.goBack()
      }
      catch (error) { if (version === this._version) this.setData({ errorMessage: error.message || '取消失败，请重试。' }) }
      finally { if (version === this._version) this.setData({ saving: false }) }
    } })
  },
  goBack() { wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/learning/index' }) }) }
})
