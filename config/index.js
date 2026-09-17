const PROJECT_ID = "ZJ2x09KOnm9";
// OpenMAIC 的 HTTPS 课程站点。发布前需在微信公众平台同时配置 request 合法域名和业务域名。
const COURSE_PORTAL_ORIGIN = "https://sike.yuandianzhixv.cn";

module.exports = {
  PROJECT_ID,
  COURSE_PORTAL_ORIGIN,
  GRAPHQL_URL: `https://zion-app.functorz.com/zero/${PROJECT_ID}/api/graphql-v2`,
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
    CLAIM_CURRENT_DAILY_COIN_CHECKIN: {
      id: "3c70dfba-adfb-41d7-a36b-08dad3c4fbe9",
    },
  },
};
