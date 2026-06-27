import { create } from "zustand";
import { trpc } from "../trpc.js";
import type { CreateWorkspaceInput, UpdateWorkspaceInput, ListWorkspacesInput } from "../trpc.js";

interface WorkspaceState {
  workspaces: any[];
  total: number;
  loading: boolean;
  error: string | null;
  listWorkspaces: (input: ListWorkspacesInput) => Promise<void>;
  createWorkspace: (input: CreateWorkspaceInput) => Promise<any>;
  updateWorkspace: (input: UpdateWorkspaceInput) => Promise<any>;
  deleteWorkspace: (id: string) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  total: 0,
  loading: false,
  error: null,

  listWorkspaces: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.workspace.list.query(input);
      set({ workspaces: res.items, total: res.total, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createWorkspace: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.workspace.create.mutate(input);
      set((state) => ({ workspaces: [res, ...state.workspaces], loading: false }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  updateWorkspace: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.workspace.update.mutate(input);
      set((state) => ({
        workspaces: state.workspaces.map((w) => (w.id === res.id ? res : w)),
        loading: false,
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deleteWorkspace: async (id) => {
    set({ loading: true, error: null });
    try {
      await trpc.workspace.delete.mutate({ id });
      set((state) => ({
        workspaces: state.workspaces.filter((w) => w.id !== id),
        loading: false,
      }));
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },
}));
