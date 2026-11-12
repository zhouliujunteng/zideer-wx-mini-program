// 帮助与反馈的内容：常见问题（FAQS）与操作指南（GUIDES），全部是本机固定内容，帮助中心与操作指南页共用。
// 2026-10-04 按小程序里的实际文案、入口逐条核对过；改了对应页面的入口或按钮文字，要回来同步这里。
//
// - 对外品牌一律写「知鹿学习」。
// - payment: true 的条目只在支付开关开着时出现（会员中心、积分包的入口关着时整个隐藏，帮助里也不提）；
//   answerPaymentClosed 是开关关着时换用的答案（去掉会员、积分包的说法）。
// - 指南每一步的 figure 是一块示意屏：screen 标题、blocks 内容块（类型见 account/help-guide/index.wxml），
//   hot 标出要点的位置（画橙边 + 点按动画），tab 画底栏（hotTab 表示要点底栏这一项）。
// - 不要写「重置测试账号」的开启码（AGENTS.md：开启码只在后端核对）。

const CATEGORIES = [
  { id: 'account', name: '账号与身份' },
  { id: 'course', name: '课程学习' },
  { id: 'assessment', name: '测评与图谱' },
  { id: 'checkin', name: '打卡与连胜' },
  { id: 'wallet', name: '积分与金币' },
  { id: 'family', name: '家长' },
  { id: 'partner', name: '邀请与推广' },
  { id: 'payment', name: '会员与付款' },
  { id: 'device', name: '显示与反馈' }
]

const HOT_WORDS = ['学习打卡', '兑换码', '金币提现', '绑定孩子', '切换家长', '课程打不开']

const FAQS = [
  // 账号与身份
  {
    id: 'guest-browse', category: 'account', title: '不登录能用吗？',
    keywords: ['游客', '登录', '注册', '随便看看'],
    answer: [
      '可以先随便看看：首页、学习、宇宙、目标、我的都能打开，没登录时「目标」显示的是示例目标导图。',
      '用到学习任务、课程、积分这些功能时会请你登录。登录用「手机号一键登录」，一个手机号只能绑定一个账号。'
    ]
  },
  {
    id: 'profile-required', category: 'account', title: '为什么提示「请先完善学习资料」？',
    keywords: ['完善资料', '建档', '学习资料', '年级', '教材', '去完善'],
    answer: [
      '登录后还要填一份学习资料（年级、教材等），课程、测评、积分都按这份资料来。',
      '点提示里的「去完善」填好就行，填完会回到原来的页面。'
    ]
  },
  {
    id: 'switch-role', category: 'account', title: '怎么从学生切换成家长（或切回学生）？', guide: 'switch-role',
    keywords: ['切换身份', '家长身份', '学生身份', '账号身份', '换成家长', '切换家长'],
    answer: [
      '「我的 → 身份与登录」（页面标题是「账号与登录」）→「账号身份」卡，点「切换为家长」或「切换为学生」。',
      '学生改家长要先完成实名认证，且年满 22 周岁；学校、年级、教材不会清空。切回学生时资料齐全会直接沿用。',
      '家长的底栏没有「目标」，切回学生就有了。'
    ]
  },
  {
    id: 'real-name', category: 'account', title: '怎么实名认证？认证后资料能改吗？', guide: 'switch-role',
    keywords: ['实名', '身份证', '认证', '生日', '性别', '户籍'],
    answer: [
      '「我的 → 身份与登录」→「实名认证」卡点「去认证」，填写真实姓名和 18 位身份证号，点「提交认证」。目前只支持身份证。',
      '认证通过后，生日、性别、户籍地按身份证写进资料并锁定，不能再改；已实名的账号也不能换证重新实名。',
      '家长绑定学生、涉及现金结算的功能，要实名认证后才开放。'
    ]
  },
  {
    id: 'phone-change', category: 'account', title: '手机号能换绑吗？怎么注销账号？',
    keywords: ['手机号', '换绑', '注销', '更换手机'],
    answer: [
      '手机号是登录时通过「手机号一键登录」绑定的，「身份与登录」里目前只能查看，暂不提供换绑。',
      '需要更换手机号、更正个人信息或注销账号，请在本页最下面点「企业微信客服」联系客服。'
    ]
  },

  // 课程学习
  {
    id: 'start-course', category: 'course', title: '怎么开始学习一节课？', guide: 'start-course',
    keywords: ['上课', '学课程', '我的课程', '开始学习', '继续学习', '课程在哪'],
    answer: [
      '打开底栏「学习」，在「我的课程」里点要学的课，进「课程详情」后点「开始学习」。学过一部分会显示「继续学习」，从上次的地方接着学。',
      '点「我的课程」旁的「课程库」能看到全部课程，也可以搜索课程。'
    ]
  },
  {
    id: 'course-making', category: 'course', title: '课程显示「制作中」是什么意思？',
    keywords: ['制作中', '制作失败', '生成', '等待', '课程没好'],
    answer: [
      '定制课程是按你的情况现做的，卡片上显示「制作中 N%」时请稍等，「课程详情」里会写「制作完成后即可学习」。',
      '显示「制作失败」时，可以在学习页点「联系老师定制课程」找老师处理。'
    ]
  },
  {
    id: 'custom-course', category: 'course', title: '定制课程是什么？怎么获得？',
    keywords: ['定制课程', '联系老师', '老师', '学习方案', '专属课程'],
    answer: [
      '定制课程是老师按你的学习情况做的课：先做一次摸底测评 → 和老师定学习方案 → 每天按任务学课程 → 讲给 AI 听，老师核验。',
      '在「学习」页点「联系老师定制课程」就能联系老师（服务时间 9:00-18:00）。生成定制课程会用到课程积分。'
    ]
  },
  {
    id: 'member-course', category: 'course', title: '首页的会员课程怎么学？', payment: true,
    keywords: ['会员课程', '查看全部', '课程库'],
    answer: [
      '首页「会员课程」→「查看全部」可以看到全部会员课程。会员点课程就能学；还没登录或还不是会员时，会先打开「定制课程」介绍页，按页面底部的按钮操作即可。'
    ]
  },
  {
    id: 'course-failed', category: 'course', title: '课程打不开或一直在加载怎么办？',
    keywords: ['打不开', '加载', '白屏', '进不去', '卡住', '无法进入', '课程链接'],
    answer: [
      '看到「课程暂时无法进入」时先点「重新加载」；还不行就点「返回学习页」，再重新点一次课程。也检查一下网络是否通畅。',
      '课程只能从小程序里进入，把链接复制到浏览器是打不开的。',
      '仍然不行，请在「问题反馈」里提交，记得打开「附带诊断信息」。'
    ]
  },
  {
    id: 'course-exit', category: 'course', title: '怎么退出课程？',
    keywords: ['退出', '返回', '关闭课程', '返回小程序'],
    answer: [
      '点课程画面里的「退出课程」（×），再点「返回小程序」；也可以直接用微信左上角的返回。退出后想接着学，点「重新进入课程」或回学习页再点一次。'
    ]
  },
  {
    id: 'daily-task', category: 'course', title: '每天的学习任务在哪看？', guide: 'daily-task',
    keywords: ['学习任务', '今天学什么', '任务', '排课', '补学', '前几天没学完', '学习时长'],
    answer: [
      '「学习」页最上面按日期排着学习任务，从今天起排 7 天，日期下有圆点表示那天有任务，点「回到今日」回到今天。',
      '任务由老师按你每天的学习时长排好。前几天没学完的会放在今天最前面，标着「前几天没学完」；点任务会从没学完的那一页接着学。'
    ]
  },
  {
    id: 'acceptance', category: 'course', title: '复述验收是什么？怎么验收一节课？', guide: 'start-course',
    keywords: ['验收', '复述', '费曼', '老师核验', '去验收', '讲给ai听', '按住说话', '语音回答'],
    answer: [
      '学完一节课的全部页面后，「课程详情」里的「复述验收」会开放（之前显示「学完后开放验收」）。点「去验收」，AI 会一次问一个问题，你按住「按住说话」用自己的话讲给它听，松手就发出；不方便说话时点左边的键盘也能打字。',
      'AI 通过后还要老师核验，老师确认后这节课的知识点才算掌握。'
    ]
  },
  {
    id: 'diagnosis-room', category: 'course', title: '诊断室怎么进？',
    keywords: ['诊断室', '老师邀请', '预约', '直播', '老师上线'],
    answer: [
      '诊断室只能通过老师发给你的预约邀请打开：打开邀请后点「进入诊断室」。老师上线后才能开始交流。',
      '没有邀请直接打开，会提示「请从老师的邀请进入」。'
    ]
  },

  // 测评与图谱
  {
    id: 'assessment-start', category: 'assessment', title: '怎么做摸底测评？要钱吗？', guide: 'assessment',
    keywords: ['测评', '摸底', '诊断', '考试', '测试', '做题'],
    answer: [
      '「我的 → 常用入口 → 测评中心」，在「摸底诊断」里选学科，再点「免费开始测评」。',
      '每个考试范围的首次诊断免费，每轮约 30 分钟，可以分次完成；中途退出，下次点「继续第 N 轮」接着做。不会的题点「暂时不会」就好，不用乱猜。'
    ]
  },
  {
    id: 'assessment-report', category: 'assessment', title: '测评报告在哪看？',
    keywords: ['报告', '测评记录', '薄弱点', '解析', '成绩'],
    answer: [
      '做完一轮点「提交本轮，生成报告」就能看到报告；以后在「测评中心 → 测评记录 → 查看全部」，或学科页的「查看报告」里找。',
      '报告里有掌握情况、知识薄弱点、提升路径，以及本轮题目与解析。'
    ]
  },
  {
    id: 'universe', category: 'assessment', title: '知识点什么时候会进入学习宇宙？',
    keywords: ['宇宙', '学习宇宙', '点亮', '掌握', '知识点'],
    answer: [
      '两种情况：测评结果较稳的知识点；课程验收通过老师核验的知识点。只通过 AI 验收、还在「待老师核验」的不算。'
    ]
  },
  {
    id: 'knowledge-map', category: 'assessment', title: '知识图谱在哪里？怎么看？',
    keywords: ['图谱', '知识图谱', '示例', '缩放'],
    answer: [
      '底栏的「图谱」换成了「目标」，知识图谱在「我的 → 知鹿服务 → 知识图谱」。',
      '双指缩放、单指移动；点知识点能看到知识说明、掌握标准、先修和后继知识点。',
      '没登录或还没完善学习资料时显示的是示例图谱，登录并完善资料后显示你自己的图谱。'
    ]
  },
  {
    id: 'goal-map', category: 'assessment', title: '「目标」页和目标导图怎么用？',
    keywords: ['目标', '目标导图', '按目标测评', '卡点', '历史目标'],
    answer: [
      '先在「目标」页定一个学习目标，再围绕目标测一轮：做错或不会的题，会往前检查它需要的基础，找到真正卡住的地方。',
      '目标导图从左往右是：目标 → 大条件 → 知识点 → 前置知识点。双指缩放、拖动查看，点卡片看说明。',
      '老师按导图给你定制课程后，课会挂在对应的卡点下面，点进去就是课程详情。',
      '换过目标也不会丢：点目标卡右上角的「历史目标」，能看到以前每个目标的导图。'
    ]
  },

  // 打卡与连胜
  {
    id: 'checkin-rule', category: 'checkin', title: '怎样才算学习打卡？', guide: 'checkin',
    keywords: ['打卡', '签到', '连胜', '连续学习', '学习打卡'],
    answer: [
      '当天学完一节课，或者通过一次费曼验收（复述验收 AI 通过），就算当天打卡，一天只记一次。',
      '「金币任务」里的「每日签到」和学习打卡是两回事，签到不算打卡。'
    ]
  },
  {
    id: 'checkin-reward', category: 'checkin', title: '打卡有奖励吗？', guide: 'checkin',
    keywords: ['打卡金币', '奖励', '连续', '送金币'],
    answer: [
      '打卡送金币活动开启时，连续打卡的天数越多送得越多（有封顶），连胜断了从头算。',
      '今天、明天能拿多少，在「学习连胜」页的任务行里写着（「+N 金币」「明天 +N 金币」）。'
    ]
  },
  {
    id: 'streak-cards', category: 'checkin', title: '冻结卡和复活卡怎么用？', guide: 'checkin',
    keywords: ['冻结卡', '复活卡', '断签', '补卡', '连胜断了'],
    answer: [
      '在「学习连胜」页点「冻结卡」或「复活卡」，看清说明后点「确认使用」。',
      '冻结卡：冻结的日子不打卡也不会断连胜。复活卡：连胜断了之后，在规定天数内把连胜补回来。冻结、补回的日子能把连胜接上，但不计入连续天数。',
      '卡片可以按「怎么获得」里的规则自动发放，也可以用兑换码兑换。'
    ]
  },
  {
    id: 'streak-entry', category: 'checkin', title: '学习连胜在哪看？', guide: 'checkin',
    keywords: ['小火苗', '火苗', '连胜', '打卡页'],
    answer: [
      '首页、学习、宇宙、目标顶部胶囊旁边的小火苗，或者「我的」里的「我的学习连胜」卡，都能进「学习连胜」页。'
    ]
  },

  // 积分与金币
  {
    id: 'credits-use', category: 'wallet', title: '课程积分有什么用？',
    keywords: ['课程积分', '积分', '扣积分', '冻结积分', '积分退回'],
    answer: [
      '课程积分用于生成定制课程：生成前先冻结，按实际用量扣，生成失败会退回。有多批积分时，先到期的先用。',
      '课程积分不能兑换现金，也不能和金币互换。在「我的 → 课程积分」能看到积分批次和获得、使用记录。'
    ]
  },
  {
    id: 'credits-get', category: 'wallet', title: '课程积分怎么获得？',
    keywords: ['获得积分', '买积分', '充值'],
    answer: [
      '开通会员会赠送积分，积分用完可以再买一次会员；参与运营活动、使用兑换码也能获得。'
    ],
    answerPaymentClosed: [
      '目前可以通过参与运营活动、使用兑换码获得课程积分。'
    ]
  },
  {
    id: 'coin-cash', category: 'wallet', title: '金币怎么兑换成现金？', guide: 'coin-cash',
    keywords: ['金币', '提现', '现金', '零钱', '兑换现金', '换钱'],
    answer: [
      '100 金币 = 1 元，转到你本人的微信零钱。「我的 → 我的金币」点「兑换现金」，选好金额点「确认兑换」，再在微信的收款页点「确认收款」。',
      '按整元兑换；单笔、每天的次数上限以「我的金币」页的「使用规则」为准。'
    ]
  },
  {
    id: 'coin-confirm', category: 'wallet', title: '兑换现金后没到账？提示「去确认收款」？', guide: 'coin-cash',
    keywords: ['没到账', '确认收款', '收款', '到账', '金币冻结'],
    answer: [
      '兑换后要在微信收款页点「确认收款」才会到零钱。中途离开了，回「我的金币」点「去确认收款」就行。',
      '兑换中的金币先冻结，到账后才扣除；24 小时内没确认收款，金币会退回。'
    ]
  },
  {
    id: 'coin-get', category: 'wallet', title: '金币怎么获得？',
    keywords: ['赚金币', '获得金币', '金币任务', '每日签到'],
    answer: [
      '学习打卡（活动开启时）、「我的金币 → 金币任务」里的每日签到和任务、兑换码都能获得金币。'
    ]
  },
  {
    id: 'orders', category: 'wallet', title: '在哪看我的订单？',
    keywords: ['订单', '我的订单', '订单记录', '购买记录', '待支付'],
    answer: [
      '「我的 → 知鹿服务 → 我的订单」（页面标题「订单记录」），可以按「全部」「待支付」「已支付」查看，点订单看详情。'
    ]
  },
  {
    id: 'redeem-code', category: 'wallet', title: '兑换码怎么用？', guide: 'redeem-code',
    keywords: ['兑换码', '激活码', '卡密', '兑换'],
    answer: [
      '「我的 → 知鹿服务 → 兑换码」，输入兑换码（也可以扫码），点「立即兑换」。',
      '每个兑换码只能用一次，可以兑换课程积分、金币、体验权益或冻结卡、复活卡。需要先登录并完善学习资料。'
    ]
  },

  // 家长
  {
    id: 'bind-student', category: 'family', title: '家长怎么绑定孩子？', guide: 'bind-student',
    keywords: ['绑定', '绑定孩子', '绑定学生', '动态码', '绑定码', '家庭关系'],
    answer: [
      '孩子在自己的账号里：「我的 → 常用入口 → 家庭关系」→「生成绑定码」，得到一个 8 位动态码。',
      '家长在自己的账号里：「家庭关系」→「绑定学生」，输入这 8 位数字，点「确认绑定」。',
      '家长要先完成实名认证，且年满 22 周岁。动态码只能用一次、过一会儿就失效，过期了让孩子点「重新生成」。'
    ]
  },
  {
    id: 'bind-blocked', category: 'family', title: '为什么提示「暂不能绑定学生」？', guide: 'bind-student',
    keywords: ['不能绑定', '22周岁', '未满', '实名'],
    answer: [
      '实名认证显示你未满 22 周岁，年满 22 周岁的家长才能绑定学生。',
      '如果你是学生，可以在「身份与登录」把账号切换回学生身份。'
    ]
  },
  {
    id: 'guardian-view', category: 'family', title: '绑定后家长能看到什么？',
    keywords: ['学生看板', '家长看', '孩子学习情况'],
    answer: [
      '可以看到孩子的学习时长、测评结果、学习计划、课程验收（包括复述录音）、老师预约以及积分和订单等学习信息。',
      '绑定后，「我的 → 常用入口」里的「测评中心」会换成「学生看板」。'
    ]
  },
  {
    id: 'guardian-tabs', category: 'family', title: '家长的底栏为什么没有「目标」？',
    keywords: ['底栏', '目标不见了', '图谱不见了', '少了'],
    answer: [
      '目标导图和知识图谱是给学生用的，家长的底栏只有首页、学习、宇宙、我的四项。切回学生身份就会显示「目标」。'
    ]
  },

  // 邀请与推广
  {
    id: 'invite', category: 'partner', title: '怎么邀请好友？', guide: 'invite',
    keywords: ['邀请', '邀请码', '小程序码', '分享', '推荐人', '小程序链接'],
    answer: [
      '「我的 → 推广伙伴」打开一张推广海报，点「复制链接」，到「小程序链接」页右上角「···」→「复制链接」发出去。也可以保存海报，让好友扫码。',
      '不再使用邀请码。爱心妈妈、团长在「推广伙伴 → 绑定家庭」里输入家长的用户 ID 绑定家庭，绑定后不能自己修改。'
    ]
  },
  {
    id: 'partner-apply', category: 'partner', title: '怎么成为推广伙伴？奖励怎么提现？',
    keywords: ['推广伙伴', '提现', '结算', '佣金', '奖励'],
    answer: [
      '在「推广伙伴 → 结算中心」点申请：先做基础核验（姓名、身份证号），再提交申请，后台 1～2 个工作日审核。',
      '开通后奖励可以整笔提现；没开通的，也可以把奖励整笔兑换成课程积分。奖励有 7 天锁定期，过了锁定期才能提现。'
    ]
  },

  // 会员与付款（支付开关开着才显示）
  {
    id: 'membership', category: 'payment', title: '怎么开通会员？', guide: 'membership', payment: true,
    keywords: ['会员', '开通会员', '会员中心', '升级会员'],
    answer: [
      '「我的」页头像下方的会员卡 →「会员中心」，选好等级后付款开通。还没上传微信二维码时，会先去上传。',
      '会员永久有效，家长开通后已绑定的孩子共用。积分用完可以再买一次会员；开通后可以按原价升级到更高等级，但不能降级。'
    ]
  },
  {
    id: 'android-pay', category: 'payment', title: '安卓手机怎么付款？', payment: true,
    keywords: ['安卓', '付款', '支付', '服务号', '订单创建成功通知', '付款链接'],
    answer: [
      '安卓手机选好会员等级后，会进入付款等待页，并收到「知鹿学习」服务号发来的「订单创建成功通知」。',
      '回到微信，打开这条通知进入付款网页，核对商品和金额后点「微信支付」。付好回到小程序，付款结果会自动更新。'
    ]
  },
  {
    id: 'paid-not-active', category: 'payment', title: '付了钱还显示没开通？', payment: true,
    keywords: ['扣款', '没开通', '重复支付', '支付失败', '订单'],
    answer: [
      '请不要重复支付。在会员中心点「重新查询状态」，或到「我的 → 我的订单」看看订单状态；仍然不对请联系客服。'
    ]
  },
  {
    id: 'refund', category: 'payment', title: '可以退款吗？', payment: true,
    keywords: ['退款', '退钱', '取消会员'],
    answer: [
      '会员等付费项目，自支付成功之日起 7 日内可以联系客服申请退款；超过 7 日不支持退款。',
      '会员退款会取消对应的会员等级，并扣回该笔赠送积分里还没用的部分。'
    ]
  },
  {
    id: 'credit-pack', category: 'payment', title: '积分用完了怎么补充？', payment: true,
    keywords: ['积分包', '买积分', '充值积分', '再买会员'],
    answer: [
      '没有单独的积分包。在「会员中心」再买一次会员，会再赠送该等级的积分。'
    ]
  },

  // 显示与反馈
  {
    id: 'tablet-display', category: 'device', title: '平板上画面太小或横竖屏错位？',
    keywords: ['平板', 'ipad', '横屏', '竖屏', '分屏', '错位', '画面小', 'oppo'],
    answer: [
      '先退出分屏或浮窗，回到完整窗口，再重新进入课程。',
      '如果横屏时还套着竖向的窄窗口，请检查平板系统里针对微信的显示设置。OPPO Pad Mini 实测可行：设置 → 显示与亮度 → 应用横屏显示 → 微信 → 原始布局（修改会关闭微信，请先退出课程）。'
    ]
  },
  {
    id: 'landscape', category: 'device', title: '课程能横屏看吗？',
    keywords: ['横屏', '旋转', '转屏', '竖屏锁定'],
    answer: [
      '可以。课程页会跟着手机方向旋转，把手机横过来就行；不转的话，检查一下手机是否开了竖屏锁定。'
    ]
  },
  {
    id: 'no-sound', category: 'device', title: '课程没有声音？',
    keywords: ['没声音', '声音', '静音', '音量', '播放'],
    answer: [
      '先检查手机媒体音量、是否连着蓝牙耳机，再退出课程重新进入。',
      '还是没有声音，请在「问题反馈」里选「播放异常」提交，并打开「附带诊断信息」。'
    ]
  },
  {
    id: 'feedback', category: 'device', title: '怎么提交问题反馈？', guide: 'feedback',
    keywords: ['反馈', '投诉', '建议', '问题反馈', '诊断信息', 'bug'],
    answer: [
      '在本页最下面点「问题反馈」，选问题类型、写下在哪个页面做了什么，点「提交反馈」。提交需要登录。',
      '提交后会得到反馈编号，和老师沟通时提供这个编号，方便排查。'
    ]
  },
  {
    id: 'contact', category: 'device', title: '怎么联系老师或客服？',
    keywords: ['客服', '企业微信', '企微', '人工', '电话', '联系', '老师'],
    answer: [
      '学习上的问题，在「学习」页点「联系老师定制课程」联系老师（服务时间 9:00-18:00）。',
      '账号、付款等其他问题，在本页最下面点「企业微信客服」，在微信里直接和客服聊（需要先登录）。'
    ]
  }
]

// 示意屏里反复用到的块
const ME_SERVICE_ITEMS = [
  { label: '推广伙伴', hint: '分享工具与奖励记录' },
  { label: '身份与登录', hint: '学生或家长身份、实名与手机号' },
  { label: '兑换码', hint: '兑换课程积分、金币或体验权益' },
  { label: '我的订单', hint: '查看购买记录与支付状态' }
]
const meServices = (hotLabel, tag) => ({
  type: 'menu',
  title: '知鹿服务',
  items: ME_SERVICE_ITEMS.map((item) => (item.label === hotLabel ? { ...item, hot: true, tag } : item))
})
const meQuick = (hotLabel, tag) => ({
  type: 'grid',
  title: '常用入口',
  items: ['测评中心', '消息中心', '账户安全', '家庭关系'].map((label) => (label === hotLabel ? { label, hot: true, tag } : { label }))
})
const meWallet = (hotLabel, tag) => ({
  type: 'tiles',
  items: [
    { label: '课程积分', value: '286', tone: 'orange' },
    { label: '我的金币', value: '1,250', tone: 'orange' }
  ].map((item) => (item.label === hotLabel ? { ...item, hot: true, tag } : item))
})

const GUIDES = [
  {
    id: 'start-course', title: '开始学习一节课', tone: 'orange',
    summary: '从「学习」页找到课程，进课程详情开始学；学完再做复述验收。',
    keywords: ['上课', '学课程', '我的课程', '验收'],
    action: { label: '去「学习」页', tab: '/pages/learning/index' },
    steps: [
      {
        title: '点底栏的「学习」',
        hint: '课程都在「学习」页；首页的「会员课程」也可以直接点进去学。',
        figure: { screen: '首页', tab: 'learning', hotTab: true, blocks: [{ type: 'card', title: '会员课程', text: '查看全部 ›' }, { type: 'lines' }] }
      },
      {
        title: '在「我的课程」里点要学的课',
        hint: '「我的课程」在学习任务下面；点旁边的「课程库」能看全部课程，也能搜索。',
        figure: {
          screen: '学习', tab: 'learning',
          blocks: [
            { type: 'card', title: '联系老师定制课程', text: '老师按你的学习情况定制课程' },
            { type: 'list', title: '我的课程', items: [
              { title: '一次函数的图像与性质', meta: '定制课程', mark: '数', hot: true },
              { title: '分式方程的解法', meta: '制作中 60%', mark: '数', tone: 'blue' }
            ] }
          ]
        }
      },
      {
        title: '在「课程详情」点「开始学习」',
        hint: '学过一部分会显示「继续学习」，从上次的地方接着学。卡片显示「制作中」时，要等制作完成。',
        figure: {
          screen: '课程详情', back: true,
          blocks: [
            { type: 'card', title: '一次函数的图像与性质', text: '定制课程' },
            { type: 'lines' },
            { type: 'button', label: '开始学习', hot: true }
          ]
        }
      },
      {
        title: '学完后去做「复述验收」',
        hint: '全部页面学完才开放验收。按住说话，把学到的内容讲给 AI 听，AI 通过后由老师核验。',
        figure: {
          screen: '课程详情', back: true,
          blocks: [
            { type: 'card', title: '复述验收', text: '把这节课讲给 AI 听', button: '去验收', hot: 'button' },
            { type: 'lines', count: 2 }
          ]
        }
      }
    ],
    tips: [
      '课程页会跟着手机方向旋转，横过来看更大。',
      '退出课程点画面里的「退出课程」，再点「返回小程序」。',
      '课程只能从小程序里进入，复制到浏览器的链接打不开。'
    ]
  },
  {
    id: 'daily-task', title: '查看每天的学习任务', tone: 'blue',
    summary: '老师按你每天的学习时长排好任务，按日期查看、点任务就能学。',
    keywords: ['学习任务', '今天学什么', '补学', '排课'],
    action: { label: '去「学习」页', tab: '/pages/learning/index' },
    steps: [
      {
        title: '在「学习」页最上面选日期',
        hint: '从今天起排 7 天，日期下有圆点表示那天有任务；点「回到今日」回到今天。',
        figure: {
          screen: '学习', tab: 'learning',
          blocks: [
            { type: 'chips', items: [{ label: '今天', active: true }, { label: '周二', hot: true, tag: '换一天' }, { label: '周三' }, { label: '周四' }, { label: '周五' }] },
            { type: 'tiles', items: [{ label: '已完成', value: '1 / 3' }, { label: '连续学习', value: '5 天' }] }
          ]
        }
      },
      {
        title: '点任务开始学',
        hint: '前几天没学完的会排在今天最前面，标着「前几天没学完」；点进去会从没学完的那一页接着学。',
        figure: {
          screen: '学习', tab: 'learning',
          blocks: [
            { type: 'list', title: '学习任务', items: [
              { title: '一次函数的图像与性质', meta: '前几天没学完', mark: '补', tone: 'pink', badge: '40%', hot: true },
              { title: '分式方程的解法', meta: '约 15 分钟', mark: '数', badge: '0%' }
            ] }
          ]
        }
      },
      {
        title: '想调整每天学多久，联系老师',
        hint: '每天学习时长由老师和你确认后安排，从 15 分钟到 2 小时不等。',
        figure: {
          screen: '学习', tab: 'learning',
          blocks: [
            { type: 'card', title: '联系老师定制课程', text: '老师按你的学习情况定制课程 · 9:00-18:00', hot: 'card' },
            { type: 'lines', count: 2 }
          ]
        }
      }
    ],
    tips: [
      '学习任务只排已经做好、还没学完的课。',
      '当天学完一节课就算学习打卡。'
    ]
  },
  {
    id: 'checkin', title: '学习打卡与连胜', tone: 'pink',
    summary: '学完一节课或通过一次复述验收就算打卡；冻结卡、复活卡帮你保住连胜。',
    keywords: ['打卡', '连胜', '冻结卡', '复活卡', '签到'],
    action: { label: '去学一节课', tab: '/pages/learning/index' },
    steps: [
      {
        title: '学完一节课，或通过一次复述验收',
        hint: '当天做到其中一样就算打卡，一天只记一次，会弹出「今日打卡完成」。',
        figure: {
          screen: '课程详情', back: true, caption: '弹窗示意 · 以实际显示为准',
          blocks: [{ type: 'card', title: '一次函数的图像与性质', text: '本课已学完' }, { type: 'lines' }],
          modal: { title: '今日打卡完成', text: '连胜又多了一天', confirm: '去打卡页查看', hot: true }
        }
      },
      {
        title: '点顶部的小火苗查看连胜',
        hint: '首页、学习、宇宙、目标的胶囊旁边都有；「我的」里的「我的学习连胜」卡也能进。',
        figure: { screen: '学习', tab: 'learning', flame: '5', flameHot: true, blocks: [{ type: 'lines' }, { type: 'lines', count: 2 }] }
      },
      {
        title: '快断连胜时，点「冻结卡」或「复活卡」',
        hint: '冻结卡：冻结的日子不打卡也不会断连胜；复活卡：连胜断了后在规定天数内补回。',
        figure: {
          screen: '学习连胜', back: true,
          blocks: [
            { type: 'card', title: '已连续学习 5 天', text: '今天还没打卡', tone: 'orange' },
            { type: 'tiles', items: [{ label: '冻结卡', value: '2 张', tone: 'blue', hot: true }, { label: '复活卡', value: '1 张', tone: 'pink' }] }
          ]
        }
      },
      {
        title: '看清说明，点「确认使用」',
        hint: '冻结、补回的日子能把连胜接上，但不计入连续天数。',
        figure: {
          screen: '学习连胜', back: true,
          blocks: [{ type: 'lines' }, { type: 'lines' }],
          modal: { title: '这次会冻结', text: '冻结的日子不打卡也不会断连胜，但不计入连续天数。', cancel: '先不用', confirm: '确认使用', hot: true }
        }
      }
    ],
    tips: [
      '「金币任务」里的「每日签到」和学习打卡是两回事。',
      '打卡送金币活动开启时，连续天数越多送得越多，以「学习连胜」页显示为准。',
      '冻结卡、复活卡可以按「怎么获得」里的规则自动发放，也能用兑换码兑换。'
    ]
  },
  {
    id: 'redeem-code', title: '使用兑换码', tone: 'purple',
    summary: '在「我的 → 兑换码」输入兑换码，课程积分、金币等权益马上到账。',
    keywords: ['兑换码', '激活码'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '打开底栏的「我的」',
        figure: { screen: '首页', tab: 'me', hotTab: true, blocks: [{ type: 'lines' }, { type: 'card', title: '会员课程', text: '查看全部 ›' }] }
      },
      {
        title: '在「知鹿服务」里点「兑换码」',
        figure: { screen: '我的', tab: 'me', blocks: [meServices('兑换码')] }
      },
      {
        title: '输入兑换码，点「立即兑换」',
        hint: '也可以点输入框旁的扫码按钮，扫一扫兑换码。',
        figure: {
          screen: '兑换码', back: true,
          blocks: [
            { type: 'card', title: '兑换你的专属权益', text: '输入兑换码，权益将进入当前学生账户。', tone: 'orange' },
            { type: 'input', value: 'ZL8K2Q7M', button: '立即兑换', hot: 'button' }
          ]
        }
      },
      {
        title: '看到「兑换成功」就到账了',
        figure: {
          screen: '兑换码', back: true, caption: '弹窗示意 · 到账内容以兑换码为准',
          blocks: [{ type: 'card', title: '兑换你的专属权益', tone: 'orange' }, { type: 'lines' }],
          modal: { title: '兑换成功', text: '课程积分 +100', confirm: '我知道', hot: true }
        }
      }
    ],
    tips: [
      '每个兑换码只能用一次。',
      '需要先登录并完善学习资料。',
      '「兑换未完成」时，弹窗里会写明原因。'
    ]
  },
  {
    id: 'coin-cash', title: '金币兑换现金', tone: 'orange',
    summary: '100 金币 = 1 元，转到你本人的微信零钱。',
    keywords: ['金币', '提现', '现金', '零钱'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '在「我的」点「我的金币」',
        figure: { screen: '我的', tab: 'me', blocks: [{ type: 'profile' }, meWallet('我的金币')] }
      },
      {
        title: '点「兑换现金」',
        figure: {
          screen: '我的金币', back: true,
          blocks: [
            { type: 'card', title: '当前可用金币 1,250', text: '冻结中：0' },
            { type: 'card', title: '可兑换 ¥12', text: '100 金币 = 1 元，直接转到微信零钱', button: '兑换现金', hot: 'button', tone: 'orange' }
          ]
        }
      },
      {
        title: '选好金额，点「确认兑换」',
        hint: '按整元兑换，用「－」「＋」调整，也可以点「全部兑换」。',
        figure: {
          screen: '兑换到微信零钱', back: true,
          blocks: [
            { type: 'chips', items: [{ label: '－' }, { label: '¥5', active: true }, { label: '＋' }] },
            { type: 'menu', items: [{ label: '兑换比例', value: '100 金币 = 1 元' }, { label: '到账方式', value: '本人微信零钱' }] },
            { type: 'button', label: '确认兑换 ¥5', hot: true }
          ]
        }
      },
      {
        title: '在微信收款页点「确认收款」',
        hint: '24 小时内要确认收款，没确认的金币会退回；中途离开了，回「我的金币」点「去确认收款」。',
        figure: {
          screen: '微信收款', back: true, caption: '收款页示意 · 以微信实际页面为准',
          blocks: [
            { type: 'card', title: '知鹿学习 向你转账', text: '¥5.00 · 转入微信零钱', tone: 'dark' },
            { type: 'button', label: '确认收款', hot: true }
          ]
        }
      }
    ],
    tips: [
      '兑换中的金币先冻结，到账后才扣除。',
      '单笔、每天的次数上限以「我的金币」页的「使用规则」为准。',
      '课程积分不能兑换现金，金币和课程积分也不能互换。'
    ]
  },
  {
    id: 'bind-student', title: '家长绑定孩子', tone: 'green',
    summary: '孩子生成 8 位动态码，家长输入后确认绑定。家长要先实名且年满 22 周岁。',
    keywords: ['绑定', '绑定孩子', '绑定学生', '动态码', '家长'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '孩子：在「我的」点「家庭关系」',
        hint: '孩子用自己的账号操作。',
        figure: { screen: '我的', tab: 'me', blocks: [meQuick('家庭关系')] }
      },
      {
        title: '孩子：点「生成绑定码」',
        figure: {
          screen: '家庭关系', back: true,
          blocks: [{ type: 'pair', items: [
            { kicker: '我是学生', title: '生成绑定码', text: '让家长绑定我', hot: true },
            { kicker: '我是家长', title: '绑定学生', text: '输入孩子的绑定码' }
          ] }]
        }
      },
      {
        title: '孩子：把 8 位动态码告诉家长',
        hint: '动态码只能用一次，过一会儿就失效；过期了点「重新生成」。',
        figure: {
          screen: '学生绑定码', back: true,
          blocks: [
            { type: 'code', label: '本次动态码', value: '4826 1937', button: '刷新动态码', hot: 'value', tag: '告诉家长' },
            { type: 'note', text: '单次使用 · 有效期以页面倒计时为准' }
          ]
        }
      },
      {
        title: '家长：在「家庭关系」点「绑定学生」',
        hint: '家长用自己的账号操作；没实名的会先请你完成实名认证。',
        figure: {
          screen: '家庭关系', back: true,
          blocks: [{ type: 'pair', items: [
            { kicker: '我是学生', title: '生成绑定码', text: '让家长绑定我' },
            { kicker: '我是家长', title: '绑定学生', text: '输入孩子的绑定码', hot: true }
          ] }]
        }
      },
      {
        title: '家长：输入动态码，点「确认绑定」',
        figure: {
          screen: '绑定学生', back: true,
          blocks: [
            { type: 'input', label: '学生动态码', value: '48261937' },
            { type: 'menu', items: [{ label: '绑定身份', value: '监护人' }] },
            { type: 'button', label: '确认绑定', hot: true }
          ]
        }
      }
    ],
    tips: [
      '家长要先在「身份与登录」完成实名认证，且年满 22 周岁。',
      '绑定后，家长「我的 → 常用入口」里会出现「学生看板」。'
    ]
  },
  {
    id: 'switch-role', title: '切换学生 / 家长身份', tone: 'teal',
    summary: '在「身份与登录」切换；学生改家长要先实名认证，且年满 22 周岁。',
    keywords: ['切换身份', '家长', '学生', '实名认证'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '在「我的」点「身份与登录」',
        figure: { screen: '我的', tab: 'me', blocks: [meServices('身份与登录')] }
      },
      {
        title: '在「账号身份」卡点「切换为家长」',
        hint: '家长想切回学生，点「切换为学生」。',
        figure: {
          screen: '账号与登录', back: true,
          blocks: [
            { type: 'card', title: '账号身份', text: '学生', button: '切换为家长', hot: 'button' },
            { type: 'card', title: '实名认证', text: '未认证' }
          ]
        }
      },
      {
        title: '还没实名的，点「去认证」',
        figure: {
          screen: '账号与登录', back: true,
          blocks: [{ type: 'lines' }, { type: 'lines' }],
          modal: { title: '先完成实名认证', text: '切换为家长需要先完成实名认证，且年满 22 周岁。认证通过后会接着为你切换。', cancel: '再想想', confirm: '去认证', hot: true }
        }
      },
      {
        title: '填写真实姓名和身份证号，提交认证',
        hint: '目前只支持身份证；认证后生日、性别、户籍地按身份证锁定。',
        figure: {
          screen: '实名认证', back: true,
          blocks: [
            { type: 'input', label: '姓名', placeholder: '请输入真实姓名' },
            { type: 'input', label: '身份证号', placeholder: '请输入18位身份证号' },
            { type: 'button', label: '提交认证', hot: true }
          ]
        }
      },
      {
        title: '确认切换',
        hint: '切换成家长后，底栏不再显示「目标」。',
        figure: {
          screen: '账号与登录', back: true, caption: '弹窗示意 · 以实际显示为准',
          blocks: [{ type: 'lines' }, { type: 'lines' }],
          modal: { title: '切换为家长', text: '切换后底栏不再显示「目标」', cancel: '再想想', confirm: '确认切换', hot: true }
        }
      }
    ],
    tips: [
      '学生改家长不会清空学校、年级、教材；切回学生时资料齐全会直接沿用。',
      '已实名的账号不能换证重新实名。'
    ]
  },
  {
    id: 'assessment', title: '做一次摸底测评', tone: 'blue',
    summary: '在测评中心选学科开始测评，每个考试范围首次免费，做完马上出报告。',
    keywords: ['测评', '摸底', '诊断', '报告'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '在「我的」点「测评中心」',
        figure: { screen: '我的', tab: 'me', blocks: [meQuick('测评中心')] }
      },
      {
        title: '在「摸底诊断」里选学科',
        figure: {
          screen: '测评中心', back: true,
          blocks: [
            { type: 'card', title: '先了解，再出发', tone: 'orange' },
            { type: 'list', title: '摸底诊断', items: [
              { title: '数学', meta: '点击开始摸底诊断', mark: '数', badge: '开始', hot: true },
              { title: '英语', meta: '点击开始摸底诊断', mark: '英', tone: 'blue', badge: '开始' }
            ] }
          ]
        }
      },
      {
        title: '点「免费开始测评」',
        hint: '每个考试范围的首次诊断免费，每轮约 30 分钟，可以分次完成。',
        figure: {
          screen: '学科摸底诊断', back: true,
          blocks: [{ type: 'card', title: '本学期 · 数学', text: '每轮约 30 分钟，可以分次完成', button: '免费开始测评', hot: 'button' }, { type: 'lines', count: 2 }]
        }
      },
      {
        title: '答完每题点「提交本题，继续」',
        hint: '不会的题点「暂时不会」，不用乱猜；最后点「提交本轮，生成报告」。',
        figure: {
          screen: '学科摸底诊断', back: true,
          blocks: [
            { type: 'lines' },
            { type: 'chips', items: [{ label: 'A' }, { label: 'B', active: true }, { label: 'C' }, { label: 'D' }] },
            { type: 'button', label: '提交本题，继续', hot: true }
          ]
        }
      }
    ],
    tips: [
      '中途退出没关系，下次点「继续第 N 轮」接着做。',
      '报告里有掌握情况、知识薄弱点、提升路径和题目解析。',
      '测评较稳的知识点会进入你的学习宇宙。'
    ]
  },
  {
    id: 'invite', title: '邀请好友', tone: 'pink',
    summary: '用推广海报或小程序链接邀请好友。不再使用邀请码，家庭由爱心妈妈按用户 ID 绑定。',
    keywords: ['邀请', '邀请码', '分享', '小程序链接'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '在「我的」点「推广伙伴」',
        figure: { screen: '我的', tab: 'me', blocks: [meServices('推广伙伴')] }
      },
      {
        title: '点一张推广海报',
        figure: {
          screen: '推广伙伴', back: true,
          blocks: [
            { type: 'card', title: '可用奖励', text: '锁定期 7 天', tone: 'orange' },
            { type: 'chips', items: [{ label: '结算中心' }, { label: '绑定家庭' }, { label: '代理身份' }] },
            { type: 'card', title: '推广海报', text: '点开后可以保存或复制链接', hot: 'card' }
          ]
        }
      },
      {
        title: '在分享里点「复制链接」',
        hint: '也可以点「保存海报」，让好友长按识别海报上的小程序码。',
        figure: {
          screen: '分享海报', back: true,
          blocks: [
            { type: 'button', label: '保存海报' },
            { type: 'button', label: '复制链接', hot: true }
          ]
        }
      },
      {
        title: '在「小程序链接」页点右上角「···」→「复制链接」',
        hint: '一定要在这一页复制。邀请码已经不用了。',
        figure: {
          screen: '小程序链接', back: true, capsuleHot: true,
          blocks: [{ type: 'card', title: '用蓝色链接邀请好友', text: '#小程序://知鹿学习/…' }, { type: 'lines', count: 2 }]
        }
      }
    ],
    tips: [
      '爱心妈妈、团长在「绑定家庭」里输入家长的用户 ID 绑定，绑定后不能自己修改。',
      '不再使用邀请码。'
    ]
  },
  {
    id: 'membership', title: '开通会员', tone: 'orange', payment: true,
    summary: '在会员中心选等级付款开通。付款前要上传微信二维码。会员永久有效，积分用完可以再买。',
    keywords: ['会员', '开通会员', '付款'],
    action: { label: '去「我的」页', tab: '/pages/me/index' },
    steps: [
      {
        title: '在「我的」点头像下方的会员卡',
        figure: { screen: '我的', tab: 'me', blocks: [{ type: 'profile' }, { type: 'card', title: '知鹿用户', text: '解锁更多专属学习权益', tone: 'dark', hot: 'card' }] }
      },
      {
        title: '选会员等级',
        hint: '各等级的价格、赠送积分和权益以会员中心为准；开通后只能往更高等级升级。',
        figure: {
          screen: '会员中心', back: true, caption: '等级与价格以会员中心为准',
          blocks: [
            { type: 'chips', items: [{ label: '等级一', active: true }, { label: '等级二', hot: true }] },
            { type: 'lines', count: 2 }
          ]
        }
      },
      {
        title: '上传微信二维码后付款',
        hint: '还没上传时会先去上传。安卓手机会收到服务号「订单创建成功通知」，打开通知完成付款。',
        figure: {
          screen: '会员中心', back: true,
          blocks: [
            { type: 'note', text: '付款前需要上传本人的微信加好友二维码，客服和导师妈妈用它联系你。' },
            { type: 'button', label: '开通', hot: true },
            { type: 'note', text: '点击付款即表示已阅读《会员服务说明》' }
          ]
        }
      }
    ],
    tips: [
      '付款后会员状态需要短暂确认；已扣款但显示未开通，请不要重复支付，点「重新查询状态」。',
      '支付成功之日起 7 日内可以联系客服申请退款。'
    ]
  },
  {
    id: 'feedback', title: '提交问题反馈', tone: 'green',
    summary: '遇到问题告诉我们，附带诊断信息能更快查到原因。',
    keywords: ['反馈', '问题反馈', '诊断信息'],
    action: { label: '去提交反馈', url: '/account/help-feedback/index' },
    steps: [
      {
        title: '在帮助与反馈页最下面点「问题反馈」',
        figure: {
          screen: '帮助与反馈', back: true,
          blocks: [
            { type: 'lines', count: 2 },
            { type: 'menu', title: '没找到答案？', items: [{ label: '问题反馈', hint: '描述遇到的问题，可附带诊断信息', hot: true }, { label: '企业微信客服', hint: '在微信里直接和客服聊' }] }
          ]
        }
      },
      {
        title: '选问题类型，写下在哪个页面做了什么',
        hint: '例如：进入课程后横过来，画面被裁切了。',
        figure: {
          screen: '问题反馈', back: true,
          blocks: [
            { type: 'chips', items: [{ label: '显示异常' }, { label: '播放异常', hot: true }, { label: '其他问题' }] },
            { type: 'input', label: '问题描述', placeholder: '请告诉我们具体页面和操作' }
          ]
        }
      },
      {
        title: '打开「附带诊断信息」，点「提交反馈」',
        hint: '提交需要登录。诊断信息不含聊天、课程内容或登录凭证。',
        figure: {
          screen: '问题反馈', back: true,
          blocks: [
            { type: 'menu', items: [{ label: '附带诊断信息', hint: '帮助我们了解设备与显示情况', value: '已打开' }] },
            { type: 'button', label: '提交反馈', hot: true }
          ]
        }
      },
      {
        title: '记下反馈编号',
        hint: '和老师沟通时提供反馈编号，方便排查。',
        figure: {
          screen: '问题反馈', back: true,
          blocks: [
            { type: 'card', title: '反馈已收到', text: '与老师沟通时，可以提供下面的反馈编号。' },
            { type: 'button', label: '复制反馈编号', hot: true }
          ]
        }
      }
    ],
    tips: [
      '诊断信息包含设备型号、系统与微信版本，以及最近的窗口变化和错误类型。',
      '也可以关闭「附带诊断信息」，只提交问题描述。'
    ]
  }
]

// 指南的插画图标（后端素材 help/guide-<id>.png，千问生图，见 scripts/ui-assets/upload-help-center-assets.mjs）
function guideIconPath(id) {
  return `/assets/help/guide-${id}.png`
}

function categoryName(id) {
  const category = CATEGORIES.find((item) => item.id === id)
  return category ? category.name : ''
}

// 能显示的常见问题：支付开关关着时去掉会员与付款相关的，答案换成不提会员、积分包的版本
function visibleFaqs({ paymentOpen = false } = {}) {
  return FAQS
    .filter((faq) => paymentOpen || !(faq.payment || faq.category === 'payment'))
    .map((faq) => (!paymentOpen && faq.answerPaymentClosed ? { ...faq, answer: faq.answerPaymentClosed } : faq))
}

function visibleGuides({ paymentOpen = false } = {}) {
  return GUIDES.filter((guide) => paymentOpen || !guide.payment)
}

function findGuide(id) {
  return GUIDES.find((guide) => guide.id === id) || null
}

module.exports = { CATEGORIES, HOT_WORDS, FAQS, GUIDES, guideIconPath, categoryName, visibleFaqs, visibleGuides, findGuide }
