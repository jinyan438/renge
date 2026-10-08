import { makePocketContact, type PocketState } from "./pocketPhoneState";
import { redActorNickname, type RedActor, type RedState } from "./pocketXiaohongshuState";

export function syncRedWechatNicknames(state: PocketState, red: RedState): PocketState {
  const contacts = state.contacts.map(contact => {
    const actor = red.actors.find(actor => actor.id === contact.sourceXiaohongshuActorId || actor.id === `contact:${contact.id}` || actor.name === contact.name);
    return actor && !contact.nickname ? { ...contact, nickname: redActorNickname(actor) } : contact;
  });
  return contacts.every((contact, index) => contact === state.contacts[index]) ? state : { ...state, contacts };
}

export function addRedWechatFriend(state: PocketState, actor: RedActor) {
  const existing = state.contacts.find(contact => contact.sourceXiaohongshuActorId === actor.id || `contact:${contact.id}` === actor.id || contact.name === actor.name);
  if (existing) {
    if (existing.nickname) return { state, contact: existing };
    const contact = { ...existing, nickname: redActorNickname(actor) };
    return { state: { ...state, contacts: state.contacts.map(item => item.id === contact.id ? contact : item) }, contact };
  }
  const profile = actor.profile;
  const contact = {
    ...makePocketContact({ name: actor.name, avatar: actor.avatar, personality: [actor.personality, profile && [profile.bio, profile.gender, profile.age ? `${profile.age}岁` : "", profile.location].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), greeting: "", sourceLabel: "小红书", sourceCharacterCardId: actor.sourceCharacterCardId }),
    sourceXiaohongshuActorId: actor.id,
    nickname: redActorNickname(actor),
  };
  return { state: { ...state, contacts: [...state.contacts, contact] }, contact };
}
