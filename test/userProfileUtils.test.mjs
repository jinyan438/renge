import assert from "node:assert/strict";
import test from "node:test";
import { createUserProfile, normalizeUserProfiles } from "../src/userProfileUtils.ts";

test("migrates a single profile without losing fields or changing its identity on reload", () => {
  const legacy = { nickname: "小月", bio: "喜欢画画", avatarImage: "/avatar.png", sendToAi: true, updatedAt: "2026-10-15" };
  const state = normalizeUserProfiles(undefined, undefined, legacy);
  assert.deepEqual(state.userProfiles, [{ id: "user-default", ...legacy }]);
  assert.equal(state.activeUserProfileId, "user-default");
  assert.deepEqual(normalizeUserProfiles(state.userProfiles, state.activeUserProfileId), state);
});

test("restores the selected profile and each profile's independent preferences", () => {
  const profiles = [createUserProfile("甲"), { ...createUserProfile("乙"), bio: "乙的资料", sendToAi: true }];
  const state = normalizeUserProfiles(JSON.parse(JSON.stringify(profiles)), profiles[1].id, { nickname: "过期资料" });
  assert.deepEqual(state.userProfiles, profiles);
  assert.equal(state.activeUserProfileId, profiles[1].id);
  assert.notEqual(profiles[0].id, profiles[1].id);
  assert.equal(profiles[0].sendToAi, false);
});

test("falls back to a surviving profile when the selected ID is absent", () => {
  const profile = createUserProfile("保留的用户");
  assert.equal(normalizeUserProfiles([profile], "deleted").activeUserProfileId, profile.id);
});

test("repairs invalid and duplicate identities without dropping valid profiles", () => {
  const state = normalizeUserProfiles([null, "bad", [], { id: "same", nickname: "甲" }, { id: "same", nickname: "乙" }, { id: "", nickname: 123, bio: false }], "same");
  assert.equal(state.userProfiles.length, 3);
  assert.equal(new Set(state.userProfiles.map(profile => profile.id)).size, 3);
  assert.deepEqual(state.userProfiles.map(profile => profile.nickname), ["甲", "乙", "User"]);
  assert.equal(state.userProfiles[2].bio, "");
  assert.equal(state.activeUserProfileId, "same");
});

test("keeps one usable profile for empty or damaged collections, preferring legacy data", () => {
  for (const profiles of [undefined, {}, [], [null, [], 123]]) {
    const state = normalizeUserProfiles(profiles, "missing", { nickname: "原用户" });
    assert.equal(state.userProfiles.length, 1);
    assert.equal(state.userProfiles[0].nickname, "原用户");
    assert.equal(state.activeUserProfileId, state.userProfiles[0].id);
  }
  assert.equal(normalizeUserProfiles().userProfiles[0].nickname, "User");
});
