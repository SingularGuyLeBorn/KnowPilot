import { create } from "zustand";
import { trpc } from "../trpc.js";
import type { CreateAgentInput, UpdateAgentInput, ListAgentsInput } from "../trpc.js";

interface AgentState {
  agents: any[];
  total: number;
  loading: boolean;
  error: string | null;
  listAgents: (input: ListAgentsInput) => Promise<void>;
  createAgent: (input: CreateAgentInput) => Promise<any>;
  updateAgent: (input: UpdateAgentInput) => Promise<any>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentState>((set) => ({
  agents: [],
  total: 0,
  loading: false,
  error: null,

  listAgents: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.agent.list.query(input);
      set({ agents: res.items, total: res.total, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createAgent: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.agent.create.mutate(input);
      set((state) => ({ agents: [res, ...state.agents], loading: false }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  updateAgent: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.agent.update.mutate(input);
      set((state) => ({
        agents: state.agents.map((a) => (a.id === res.id ? res : a)),
        loading: false,
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteAgent: async (id) => {
    set({ loading: true, error: null });
    try {
      await trpc.agent.delete.mutate({ id });
      set((state) => ({
        agents: state.agents.filter((a) => a.id !== id),
        loading: false,
      }));
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },
}));
