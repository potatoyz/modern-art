export const CATEGORIES = [
  { id: 0, name: 'Lite Metal', en: 'Lite Metal', color: '#e5bd39', light: '#fff4bd', mark: '◒', count: 12 },
  { id: 1, name: 'Yoko', en: 'Yoko', color: '#518ec4', light: '#e0edf9', mark: '◉', count: 13 },
  { id: 2, name: 'Christin P.', en: 'Christin P.', color: '#639858', light: '#e5f0dc', mark: '△', count: 14 },
  { id: 3, name: 'Krypto', en: 'Krypto', color: '#c7554e', light: '#f9e2dc', mark: '☀', count: 15 },
  { id: 4, name: 'Karl Gitter', en: 'Karl Gitter', color: '#df8c35', light: '#ffebd0', mark: '⌂', count: 16 },
];
export const METHODS = {
  open: { name: '公开拍卖', icon: '↗', hint: '任何人都能加价。按房间超时设置或其余玩家退出后落槌。' },
  once: { name: '一轮拍卖', icon: '↻', hint: '从主持人左手边开始，每人仅一次出价机会，主持人最后。确认出价后不可修改。' },
  sealed: { name: '秘密拍卖', icon: '?', hint: '每人秘密出价一次，全部提交后同时揭晓。' },
  fixed: { name: '一口价拍卖', icon: '$', hint: '主持人定价，依次选择购买。无人买则主持人自购。' },
  double: { name: '组合拍卖', icon: '▧', hint: '配一张同类别的非组合牌，一起拍卖，使用第二张的方式。' },
};
// PDF provides category totals but not symbol frequencies. This edition's explicit configuration.
export const SYMBOL_DISTRIBUTION = [
  { open: 3, once: 2, sealed: 2, fixed: 3, double: 2 },
  { open: 3, once: 3, sealed: 2, fixed: 3, double: 2 },
  { open: 3, once: 3, sealed: 3, fixed: 3, double: 2 },
  { open: 4, once: 3, sealed: 3, fixed: 3, double: 2 },
  { open: 4, once: 3, sealed: 3, fixed: 3, double: 3 },
];
const TITLES = [
  ['柠檬的午后', '花瓶里的春天', '橘子与蓝桌布', '一杯好天气'],
  ['贝雷帽朋友', '午睡的诗人', '粉红色星期天', '小小收藏家'],
  ['远山来信', '蓝色的海湾', '云朵旅行家', '山顶上的月亮'],
  ['岛屿慢时光', '海风吹过来', '南方的夏天', '椰树与日光'],
  ['巷口的红屋顶', '回家经过的树', '小城放晴', '街角咖啡馆'],
];
export const CARDS = CATEGORIES.flatMap(c => {
  let n = 0;
  return Object.entries(SYMBOL_DISTRIBUTION[c.id]).flatMap(([method, count]) => Array.from({ length: count }, () => {
    const serial = n++;
    return { id: `${c.id}-${serial}`, category: c.id, method, serial, title: TITLES[c.id][serial % 4] };
  }));
});
const cardMap = new Map(CARDS.map(c => [c.id, c]));
export const cardById = id => cardMap.get(id);
export const DEALS = { 3: [10, 6, 6, 0], 4: [9, 4, 4, 0], 5: [8, 3, 3, 0] };
