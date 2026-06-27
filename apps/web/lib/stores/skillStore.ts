import { create } from "zustand";
import { trpc } from "../trpc.js";
import type { CreateSkillInput, UpdateSkillInput, ListSkillsInput } from "../trpc.js";

interface SkillState {
  skills: any[];
  total: number;
  loading: boolean;
  error: string | null;
  listSkills: (input: ListSkillsInput) => Promise<void>;
  createSkill: (input: CreateSkillInput) => Promise<any>;
  updateSkill: (input: UpdateSkillInput) => Promise<any>;
  deleteSkill: (id: string) => Promise<void>;
}

export const useSkillStore = create<SkillState>((set) => ({
  skills: [],
  total: 0,
  loading: false,
  error: null,

  listSkills: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.skill.list.query(input);
      set({ skills: res.items, total: res.total, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createSkill: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.skill.create.mutate(input);
      set((state) => ({ skills: [res, ...state.skills], loading: false }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  updateSkill: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.skill.update.mutate(input);
      set((state) => ({
        skills: state.skills.map((s) => (s.id === res.id ? res : s)),
        loading: false,
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteSkill: async (id) => {
    set({ loading: true, error: null });
    try {
      await trpc.skill.delete.mutate({ id });
      set((state) => ({
        skills: state.skills.filter((s) => s.id !== id),
        loading: false,
      }));
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },
}));
