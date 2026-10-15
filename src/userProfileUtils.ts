export type UserProfile = {
  id: string;
  nickname: string;
  bio: string;
  avatarImage: string;
  sendToAi: boolean;
  updatedAt: string;
};

export type UserProfileState = {
  userProfiles: UserProfile[];
  activeUserProfileId: string;
};

export function createUserProfile(nickname = "User"): UserProfile {
  return {
    id: crypto.randomUUID(),
    nickname,
    bio: "",
    avatarImage: "",
    sendToAi: false,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeUserProfile(raw: unknown, fallbackId: string): UserProfile {
  const profile = raw && typeof raw === "object" ? raw as Partial<UserProfile> : {};
  return {
    id: typeof profile.id === "string" && profile.id.trim() ? profile.id : fallbackId,
    nickname: typeof profile.nickname === "string" ? profile.nickname : "User",
    bio: typeof profile.bio === "string" ? profile.bio : "",
    avatarImage: typeof profile.avatarImage === "string" ? profile.avatarImage : "",
    sendToAi: Boolean(profile.sendToAi),
    updatedAt: typeof profile.updatedAt === "string" ? profile.updatedAt : new Date().toISOString(),
  };
}

export function normalizeUserProfiles(
  rawProfiles?: unknown,
  rawActiveId?: unknown,
  legacyProfile?: unknown,
): UserProfileState {
  const ids = new Set<string>();
  const userProfiles = (Array.isArray(rawProfiles) ? rawProfiles : [])
    .filter((profile) => profile && typeof profile === "object" && !Array.isArray(profile))
    .map((raw, index) => {
      const profile = normalizeUserProfile(raw, `user-${index + 1}`);
      const baseId = profile.id;
      let suffix = 1;
      while (ids.has(profile.id)) profile.id = `${baseId}-${suffix++}`;
      ids.add(profile.id);
      return profile;
    });
  if (userProfiles.length === 0) {
    userProfiles.push(normalizeUserProfile(legacyProfile, "user-default"));
  }
  return {
    userProfiles,
    activeUserProfileId: userProfiles.find((profile) => profile.id === rawActiveId)?.id ?? userProfiles[0].id,
  };
}
