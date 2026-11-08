const PROJECT_ID = "ZJ2x09KOnm9";
// OpenMAIC 的 HTTPS 课程站点。发布前需在微信公众平台同时配置 request 合法域名和业务域名。
const COURSE_PORTAL_ORIGIN = "https://course.zideer.cn";
// 官网。知识星河页面在小程序里用 web-view 打开，发布前需把 zideer.cn 配成业务域名。
const SITE_ORIGIN = "https://zideer.cn";

module.exports = {
  PROJECT_ID,
  COURSE_PORTAL_ORIGIN,
  SITE_ORIGIN,
  GALAXY_URL: `${SITE_ORIGIN}/galaxy.html?from=miniprogram`,
  // 物理实验室（首页入口）：课程站上的静态页（课程服务 public/physics-lab/，源码在项目 physics-lab/），course.zideer.cn 已是业务域名。
  PHYSICS_LAB_URL: `${COURSE_PORTAL_ORIGIN}/physics-lab/index.html`,
  GRAPHQL_URL: `https://zion-app.functorz.com/zero/${PROJECT_ID}/api/graphql-v2`,
  // 小程序订阅消息模板（微信公众平台 › 功能 › 订阅消息 里选用后拿到的模板 ID）。
  // 诊断会议开课提醒：模板 ID 与下面的提醒动作流都填上，会议准备页的「订阅通知」按钮才会出现——
  // 只有前端授权、没有后端到点发送，等于答应了学生却不兑现，所以两样缺一不给按钮。
  SUBSCRIBE_TEMPLATES: {
    LIVE_MEETING_REMINDER: "",
  },
  ZAI: {
    PROMOTION_POSTER_BACKGROUND: {
      id: "dp83vhtoy",
      inputKey: "j59088c7s",
    },
  },
  ACTION_FLOWS: {
    K12_ASSESSMENT: { id: "c6800492-75b8-663d-7fac-4e6a27355d46" },
    GET_CURRENT_MEMBERSHIP: { id: "036a0142-82fa-b154-7edb-a85c3aba6d19" },
    CREATE_MEMBERSHIP_ORDER: { id: "a5ceaa32-d9cd-4cd0-d589-8d23032d3fbb" },
    GET_PHONE_LOGIN_STATE: { id: "c1319aac-5d2c-4872-8ad4-7358254a93fc" },
    BIND_WECHAT_PHONE: { id: "2cd366b9-322c-4b18-b73a-031aca9ee77c" },
    INITIALIZE_CURRENT_USER: {
      id: "d16370dd-e77f-46aa-960d-f57379c1d000",
    },
    RESET_DEVELOPMENT_ACCOUNT: {
      id: "2849f6c0-520f-edff-e4dc-176919ba296b",
    },
    GET_CURRENT_LEARNING_PROFILE: {
      id: "5d417aed-1f56-c527-fe3b-971f5eb944fe",
    },
    SAVE_CURRENT_LEARNING_PROFILE: {
      id: "8b6ead87-086f-4e11-ba74-1bc6852267b2",
    },
    GET_CURRENT_STUDENT_KNOWLEDGE_MAP: {
      id: "083459d7-d341-7f99-7b17-2b4b92902862",
    },
    GET_CURRENT_K12_TOPIC_DETAIL: {
      id: "bbf9c1d4-1665-52d6-94a1-18b5bdaa93ba",
    },
    GET_CURRENT_ASSESSMENT_CENTER: {
      id: "cd1e3f0c-c18f-45f5-ad00-8bc44650f545",
    },
    GET_CURRENT_DIAGNOSTIC_REPORTS: {
      id: "a80f8138-65f5-febd-5737-4be865060f20",
    },
    GET_CURRENT_LEARNING_PLANS: {
      id: "a93e4aa2-989d-a55c-9348-cf1b889cc27b",
    },
    GET_CURRENT_LIVE_SCHEDULE: {
      id: "61446a3a-9c6c-223b-d29f-1057a9d09f78",
    },
    GET_CURRENT_TEACHER_WORKSPACE: {
      id: "b730d505-ee6c-4c33-8e04-e1d9e1762205",
    },
    BIND_STUDENT_AS_CURRENT_TEACHER: {
      id: "01f2014e-3839-427a-91f6-f0a6df22e48a",
    },
    CREATE_TEACHER_AGENT_INVITE: {
      id: "a5f0da8a-e42d-4136-940d-736f32655fe3",
    },
    GET_TEACHER_AGENT_INVITE: {
      id: "e0238566-2dcd-407d-9642-f5dbe73e2184",
    },
    MARK_TEACHER_AGENT_SESSION: {
      id: "e6967781-31db-4fe5-9fbd-c8447d55500a",
    },
    // 由 scripts/mp-teacher/deploy-teacher-student-flow.mjs 部署（2026-09-21 上线，见 docs/老师工作台学生详情与预约实施记录.md）。
    TEACHER_STUDENT_SERVICE: {
      id: "7658a68b-fc0b-e22d-0315-c825538eabb0",
    },
    // 陪跑直播间（消息记录 / 已读 / 老师插话）。由 scripts/mp-teacher/deploy-live-room.mjs 部署
    // （2026-09-22 上线，见 docs/陪跑直播间等待与AI开场记录.md）。
    // id 为空时直播间照常上课，只是没有已读状态、老师也插不了话。
    LIVE_ROOM_SERVICE: {
      id: "2eccfb35-3485-e73b-c037-1ee138bc60bb",
    },
    // 诊断会议开课提醒：记录学生的订阅、到点调微信 subscribeMessage.send。尚未部署。
    LIVE_MEETING_REMINDER: {
      id: "",
    },
    GET_CURRENT_SERVICE_CONTACTS: {
      id: "6ff52f1d-697a-4325-803d-0bb85750ab25",
    },
    GET_CURRENT_LEARNING_PLAN_CANDIDATES: {
      id: "7071bdd1-dcfd-7957-947a-79c058e4127a",
    },
    ADD_CURRENT_LEARNING_PLAN_CANDIDATE: {
      id: "20eea747-192b-bfaf-a5cf-f92b584a64f9",
    },
    REMOVE_CURRENT_LEARNING_PLAN_CANDIDATE: {
      id: "04943d6f-e91b-53c5-8f06-1a94f5df7143",
    },
    CREATE_CURRENT_FEYNMAN_ACCEPTANCE: {
      id: "eb73db81-30f5-47db-8055-ced3d721dc88",
    },
    REGISTER_CURRENT_ACCEPTANCE_AUDIO: {
      id: "dee45b03-267b-44f5-bf4e-722f02dd7eef",
    },
    GET_CURRENT_REMEDIATION_TASKS: {
      id: "e9fbeaf6-b8b2-43bf-8cc3-2621988e7b48",
    },
    GENERATE_CURRENT_LEARNING_PLAN: {
      id: "b4450e1f-c426-419c-99d6-860c9d5e0b46",
    },
    CREATE_CURRENT_COURSE_GENERATION_QUOTE: {
      id: "d4da91a1-bb06-4354-80e4-7ab161ea70cf",
    },
    CONFIRM_CURRENT_COURSE_GENERATION: {
      id: "abad5981-00e2-4933-85d1-80e2e4ccc5de",
    },
    GET_CREDIT_PRODUCTS: {
      id: "92270e65-c082-47b3-bb77-3dba60b2d7fd",
    },
    GET_CURRENT_CREDIT_ACCOUNT: {
      id: "a39cf687-7560-445f-a9de-c7cfcc9775de",
    },
    CREATE_SECURE_CREDIT_ORDER: {
      id: "be783e0e-6979-4349-b5db-91d4706ea7c8",
    },
    // 支付开关（2026-09-30）：游客、已登录用户都能调，只返回开 / 关（services/payment-switch.js）。
    // 编号由 scripts/payment-switch/deploy-payment-switch-zion.mjs --apply 建好流程后自动回填；空着时按开着处理。
    GET_PAYMENT_SWITCH: {
      id: "23aa6bcd-a006-e2be-e1e0-3dc738a1cf8a",
    },
    SUBMIT_PROMOTER_ASSIGNMENT_REQUEST: {
      id: "b57b72da-b06f-4c11-af0b-a0ecbc518cd2",
    },
    GET_CURRENT_PROMOTER_ASSIGNMENT_REQUEST: {
      id: "36b1e689-e5d2-4343-a946-b76c28dd5fc2",
    },
    CANCEL_CURRENT_PROMOTER_ASSIGNMENT_REQUEST: {
      id: "e2f719cd-0ab2-473d-bbdc-f8dbc54025a0",
    },
    GET_CURRENT_FAMILY_RELATIONS: {
      id: "a41d0390-97e0-43ec-a9a2-a6993eff3692",
    },
    CREATE_CURRENT_STUDENT_BINDING_CODE: {
      id: "87118c05-8c85-4771-a09e-86af9c6e0451",
    },
    BIND_CURRENT_GUARDIAN_TO_STUDENT: {
      id: "e3ef3cd7-d675-4cf8-8c62-f593de8f3d78",
    },
    GET_CURRENT_IDENTITY_VERIFICATION: {
      id: "560f3137-b0ca-4092-ad85-976a8cee4b8b",
    },
    SUBMIT_CURRENT_GUARDIAN_IDENTITY_VERIFICATION: {
      id: "5e2fec73-6d4f-4e2c-96cc-2c2cdc1236b2",
    },
    GET_CURRENT_GROWTH_CENTER: {
      id: "82fbecc3-b04e-471e-be95-43f605fa901d",
    },
    REDEEM_CURRENT_STUDENT_CODE: {
      id: "fa089b94-8390-4ca3-b4c3-d23b061014d2",
    },
    GET_CURRENT_GUARDIAN_DASHBOARD: {
      id: "eb5ff197-5be5-803b-cda0-e4e0c80f0dcc",
    },
    GET_CURRENT_LOGIN_IDENTITIES: {
      id: "60a1a846-11ab-d643-1d08-0f512af1d1a8",
    },
    GET_CURRENT_GUARDIAN_LEARNING_FEED: {
      id: "51307280-9ef6-2479-7fae-199b05da9aea",
    },
    GET_AUTHORIZED_TOPIC_LEARNING_REPORTS: {
      id: "a59ea57c-e98e-e629-bc8f-127605e3f148",
    },
    AUTHORIZE_ACCEPTANCE_AUDIO: {
      id: "0c26ce12-494c-4efe-8a53-7f26ee53ca32",
    },
    GET_CURRENT_NOTIFICATIONS: {
      id: "54896ca4-879d-4591-b277-bf22b8c0f816",
    },
    MARK_CURRENT_NOTIFICATION_READ: {
      id: "b3451633-f5e4-4e44-a6f1-4bb952e8261a",
    },
    CREATE_WECHAT_PAYMENT_TEST_ORDER: {
      id: "edbb6241-d54e-4419-9cbd-d57873ea1870",
    },
    CREATE_CURRENT_PROMOTER_INVITATION: {
      id: "ee9c57e9-908b-4e41-bfb5-eebc4236b51f",
    },
    RECORD_CURRENT_PROMOTION_TOUCH_AND_ATTRIBUTE: {
      id: "c3f73bc4-8e61-4bec-a3a5-ab5c7421109c",
    },
    GET_CURRENT_PUBLISHED_PROMOTION_ASSETS: {
      id: "ec11ac62-f933-4700-b6a4-0d00c0ef3294",
    },
    // 邀请码中心（2026-09-22）：取我的邀请码与小程序码、把码合成到海报、按码绑定推荐人、读推荐人。
    // （对外叫「邀请码」，Zion 里的流名与字段仍是 promotion_code。）
    PROMOTION_CODE_CENTER: {
      id: "3a24592a-0357-a16d-4f66-28c9834c53a7",
    },
    // 每日学习打卡：当天学完一节课或费曼验收通过算一天（2026-09-25），另读冻结 / 复活日、道具卡与打卡金币。只读。
    GET_CURRENT_LEARNING_CHECKIN: {
      id: "8c5cc15b-e766-5512-fda2-16369afadb85",
    },
    // 使用学习连胜道具卡（冻结卡 / 复活卡，2026-09-25）：AF48，已登录用户调用。
    USE_CURRENT_STREAK_CARD: {
      id: "341f5a26-0a74-2486-cbed-776c6e5cf98e",
    },
    // 推广结算中心（2026-09-26）：AF49，已登录用户调用。整笔提现（开通推广伙伴后）、整笔兑换积分、我的结算记录。
    // 编号由 scripts/promotion-settlement/deploy-promotion-settlement-zion.mjs 上线后写入；占位时页面提示「暂未开放」。
    PROMOTION_SETTLEMENT_CENTER: {
      id: "a0f3ab62-0a1c-a745-bfda-9faa6ddf1d57",
    },
    CLAIM_CURRENT_DAILY_COIN_CHECKIN: {
      id: "3c70dfba-adfb-41d7-a36b-08dad3c4fbe9",
    },
  },
};
