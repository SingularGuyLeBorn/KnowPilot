/**
 * 运行栏「已消费」卡片 → 消息区投递气泡定位。
 * ChatMessageList 注册查找；RuntimeStatusPanel 发起请求。
 * 返回 true = 当前列表命中并已滚动。
 */

type LocateHandler = (jobId: string) => boolean;

const handlers = new Set<LocateHandler>();

export function registerDeliveryLocateHandler(handler: LocateHandler): () => void {
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
  };
}

export function requestLocateDelivery(jobId: string): boolean {
  const id = jobId.trim();
  if (!id) return false;
  for (const handler of handlers) {
    if (handler(id)) return true;
  }
  return false;
}
