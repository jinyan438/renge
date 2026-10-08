import { POCKET_HORMONES } from "../src/pocketPhoneInner.ts";

export function fixtureWechatTurn(raw, round = 1) {
  let messages;
  try { messages = JSON.parse(raw); } catch { messages = { texts: [raw] }; }
  const thoughts = ["他说想吃草莓的时候，我已经悄悄开始期待周末了。其实比起甜点，我更想和他一起慢慢走回家。", "嘴上说只是顺路，其实一直等着这条消息。好像有一点被放在心上的感觉，原来的紧张也慢慢松开了。", "刚刚那句话还在心里转。我想把在意藏得自然一些，又怕沉默让他误会……还是先分享一点今天的小事吧。"];
  return JSON.stringify({ ...messages, innerMonologue: thoughts[(round - 1) % thoughts.length], hormones: Object.fromEntries(POCKET_HORMONES.map((item, index) => [item.key, 40 + index * 3 + round % 10])) });
}
