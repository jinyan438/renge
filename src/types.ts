export type InfluenceLevel = "HIGH" | "MEDIUM" | "LOW";

export interface PersonalityEntry {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
  updatedAt: string;
}

export interface PersonalityEntryType {
  id: string;
  name: string;
  influence: InfluenceLevel;
  entries: PersonalityEntry[];
  updatedAt: string;
}

export interface AgentPersona {
  id: string;
  name: string;
  avatarImage?: string;
  description: string;
  entryTypes: PersonalityEntryType[];
  modelProfile: {
    provider: string;
    model: string;
    temperature: number;
    responseStyle: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PersonaAdapter {
  list(): Promise<AgentPersona[]>;
  save(personas: AgentPersona[]): Promise<void>;
}
