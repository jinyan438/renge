import { makePocketContact, type PocketState } from "./pocketPhoneState";
import type { RedActor } from "./pocketXiaohongshuState";

export function addRedWechatFriend(state: PocketState, actor: RedActor) {
  const existing = state.contacts.find(contact => contact.sourceXiaohongshuActorId === actor.id || `contact:${contact.id}` === actor.id || contact.name === actor.name);
  if (existing) return { state, contact: existing };
  const profile = actor.profile;
  const contact = {
    ...makePocketContact({ name: actor.name, avatar: actor.avatar, personality: [actor.personality, profile && [profile.bio, profile.gender, profile.age ? `${profile.age}岁` : "", profile.location].filter(Boolean).join(" · ")].filter(Boolean).join("\n"), greeting: "", sourceLabel: "小红书", sourceCharacterCardId: actor.sourceCharacterCardId }),
    sourceXiaohongshuActorId: actor.id,
  };
  return { state: { ...state, contacts: [...state.contacts, contact] }, contact };
}
