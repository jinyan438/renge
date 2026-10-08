import assert from "node:assert/strict";
import test from "node:test";
import { emptyPocketState, makePocketContact, normalizePocketState } from "../src/pocketPhoneState.ts";
import { makePocketGroup } from "../src/pocketPhoneGroup.ts";
import { appendPocketAttachment, applyPocketTransferReplies, editPocketBalance, normalizePocketAttachment, parsePocketMoney, pocketMediaPrompt, pocketReplyMessages, settlePocketTransfer } from "../src/pocketWechatMedia.ts";
import { applyPocketContextChanges } from "../src/pocketPhoneSync.ts";
import { syncPocketContext } from "../src/pocketPhoneContext.ts";

const contact = name => makePocketContact({ name, avatar: "/touxiang/1.png", personality: "朋友", greeting: "", sourceLabel: "" });
const fixture = () => ({ ...emptyPocketState(), contacts: [contact("奶糖"), contact("薄荷")] });
const transfer = amount => ({ kind: "transfer", amount, note: "午饭钱", status: "pending" });

test("old phone data starts at zero and edits survive normalization", () => {
  const old = fixture(); delete old.wallet;
  const restored = normalizePocketState(old);
  assert.deepEqual(restored.wallet, { balance: 0, bills: [] });
  const edited = editPocketBalance(restored, 100.12);
  assert.equal(edited.wallet.balance, 100.12); assert.equal(edited.wallet.bills[0].amount, 100.12);
  assert.deepEqual(normalizePocketState(JSON.parse(JSON.stringify(edited))), edited);
  assert.equal(normalizePocketState({ ...edited, wallet: { balance: Infinity, bills: [null] } }).wallet.balance, 0);
  for (const value of ["", "-1", "NaN", "1e2", "1.001", "0", "9999999999"]) assert.throws(() => parsePocketMoney(value));
  assert.equal(parsePocketMoney("0", true), 0); assert.equal(parsePocketMoney("5.20"), 5.2);
});

test("outgoing debits, insufficient funds and refunds have atomic, idempotent balances", () => {
  const state = editPocketBalance(fixture(), .3); const id = state.contacts[0].id;
  const sent = appendPocketAttachment(state, id, { ...transfer(.1), recipientId: id });
  assert.equal(sent.wallet.balance, .2); assert.equal(state.wallet.balance, .3);
  assert.throws(() => appendPocketAttachment(sent, id, transfer(.21)), /余额不足/);
  assert.equal(sent.contacts[0].messages.length, 1);
  const mid = sent.contacts[0].messages[0].id;
  const refunded = settlePocketTransfer(sent, id, mid, "returned", "assistant");
  assert.equal(refunded.wallet.balance, .3); assert.equal(refunded.contacts[0].messages[0].attachment.status, "returned");
  assert.equal(settlePocketTransfer(refunded, id, mid, "returned", "assistant"), refunded);
  assert.equal(settlePocketTransfer(sent, id, mid, "received", "user"), sent);
});

test("incoming transfers add money only when accepted, exactly once; refusals do not add money", () => {
  const state = fixture(); const id = state.contacts[0].id;
  const incoming = pocketReplyMessages(["[转账:5.20:奶茶钱]"], new Date().toISOString(), "");
  state.contacts[0].messages = incoming;
  assert.equal(state.wallet.balance, 0);
  const received = settlePocketTransfer(state, id, incoming[0].id, "received", "user");
  assert.equal(received.wallet.balance, 5.2); assert.equal(received.wallet.bills.length, 1);
  assert.equal(settlePocketTransfer(received, id, incoming[0].id, "received", "user"), received);
  const declined = settlePocketTransfer(state, id, incoming[0].id, "returned", "user");
  assert.equal(declined.wallet.balance, 0); assert.equal(declined.wallet.bills.length, 0);
});

test("a group transfer can be accepted only by its named recipient", () => {
  const state = editPocketBalance(fixture(), 10);
  const group = makePocketGroup("午饭群", state.contacts, "我"); state.groups.push(group);
  const sent = appendPocketAttachment(state, group.id, { ...transfer(2), recipientId: state.contacts[0].id, recipientName: "奶糖" });
  const mid = sent.groups[0].messages[0].id;
  assert.equal(settlePocketTransfer(sent, group.id, mid, "received", "assistant", state.contacts[1].id), sent);
  const received = settlePocketTransfer(sent, group.id, mid, "received", "assistant", state.contacts[0].id);
  assert.equal(received.groups[0].messages[0].attachment.status, "received"); assert.equal(received.wallet.balance, 8);
  assert.doesNotMatch(pocketMediaPrompt(sent.groups[0], state.contacts[1].id), new RegExp(mid));
});

test("validated model tokens settle only existing outgoing cards", () => {
  const state = editPocketBalance(fixture(), 10); const id = state.contacts[0].id;
  const sent = appendPocketAttachment(state, id, { ...transfer(2), recipientId: id }); const mid = sent.contacts[0].messages[0].id;
  assert.match(pocketMediaPrompt(sent.contacts[0]), new RegExp(mid));
  const replies = pocketReplyMessages([`[收款:${mid}]`, "谢谢"], new Date().toISOString(), mid);
  const received = applyPocketTransferReplies(sent, id, replies);
  assert.equal(received.wallet.balance, 8); assert.equal(received.contacts[0].messages[0].attachment.status, "received");
  assert.equal(replies[0].content, "[已收款]"); assert.equal(applyPocketTransferReplies(received, id, pocketReplyMessages([`[收款:${mid}]`], "", "")), received);
});

test("image and voice cards persist, share text context and retain wallet through edits/deletions", () => {
  let state = fixture(); const id = state.contacts[0].id;
  state = appendPocketAttachment(state, id, { kind: "image", description: "草莓蛋糕", url: "data:image/png;base64,AAAA" });
  state = appendPocketAttachment(state, id, { kind: "voice", text: "今天一起吃蛋糕", seconds: 3, shown: true });
  const restored = normalizePocketState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(restored, state);
  const history = syncPocketContext([], null, state.contacts, "我");
  assert.match(history[0].content, /图片.*草莓蛋糕/); assert.match(history[1].content, /语音 3秒.*一起吃蛋糕/);
  const edited = applyPocketContextChanges(state, [{ contactId: id, messageId: state.contacts[0].messages[0].id, content: null }]);
  assert.deepEqual(edited.wallet, state.wallet); assert.equal(edited.contacts[0].messages.length, 1);
  assert.equal(normalizePocketAttachment({ kind: "voice", text: "好", seconds: 61 }), undefined);
  assert.equal(normalizePocketAttachment({ ...transfer(.001) }), undefined);
  assert.equal(normalizePocketAttachment({ kind: "image", description: "图", url: "javascript:alert(1)" }).url, undefined);
});
