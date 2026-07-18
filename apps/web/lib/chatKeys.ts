/**
 * Chat 临时键与 sessionStorage 持久化键 —— 单一事实源（W16b 单源化）。
 *
 * - NEW_STREAM_KEY：新会话首条消息发起时尚无 sessionId，三层 store
 *   （useSessionMessages / useStreamLifecycle / useSessionComposeState）统一用该临时键。
 * - LIFECYCLE_STORAGE_KEY / COMPOSE_STORAGE_KEY：刷新/切换标签页前把
 *   StreamLifecycle / Compose 双 store 序列化到 sessionStorage 的键，
 *   写入（useChatRunStream.saveChatStoresToStorage）与恢复（chat.tsx mount）共用。
 */
export const NEW_STREAM_KEY = "__new__";
export const LIFECYCLE_STORAGE_KEY = "kp:chat-lifecycle-states";
export const COMPOSE_STORAGE_KEY = "kp:chat-compose-states";
/** 标签栏标题缓存：session 不在 list 页或后端短暂不可用时仍显示可读名 */
export const TAB_TITLE_CACHE_KEY = "kp:chat-tab-titles-v1";
