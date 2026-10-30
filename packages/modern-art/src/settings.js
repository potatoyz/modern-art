export const OPEN_SECONDS = 15;
export const MAX_TIMEOUT_SECONDS = 3600;

export function roomSettings(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('无效的房间设置。');
  const { timeoutEnabled = true, timeoutSeconds = OPEN_SECONDS } = value;
  if (typeof timeoutEnabled !== 'boolean') throw new Error('超时开关必须为开启或关闭。');
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
    throw new Error(`超时时长必须为 1–${MAX_TIMEOUT_SECONDS} 秒的整数。`);
  }
  return { timeoutEnabled, timeoutSeconds };
}
