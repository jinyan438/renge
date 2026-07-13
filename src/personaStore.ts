import { normalizePersona, seedPersonas } from "./personaData";
import type { AgentPersona, PersonaAdapter } from "./types";

const STORAGE_KEY = "renge.agent.personas.v1";

export class LocalPersonaAdapter implements PersonaAdapter {
  async list() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedPersonas;

    try {
      const parsed = JSON.parse(raw) as AgentPersona[];
      return Array.isArray(parsed) && parsed.length > 0 ? parsed.map(normalizePersona) : seedPersonas;
    } catch {
      return seedPersonas;
    }
  }

  async save(personas: AgentPersona[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(personas));
  }
}

export const personaStore = new LocalPersonaAdapter();
