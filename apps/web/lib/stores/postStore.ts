import { create } from "zustand";
import { trpc } from "../trpc.js";
import type { CreatePostInput, UpdatePostInput, ListPostsInput } from "../trpc.js";

interface PostState {
  posts: any[];
  total: number;
  loading: boolean;
  error: string | null;
  listPosts: (input: ListPostsInput) => Promise<void>;
  createPost: (input: CreatePostInput) => Promise<any>;
  updatePost: (input: UpdatePostInput) => Promise<any>;
  deletePost: (id: string) => Promise<void>;
}

export const usePostStore = create<PostState>((set) => ({
  posts: [],
  total: 0,
  loading: false,
  error: null,

  listPosts: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.post.list.query(input);
      set({ posts: res.items, total: res.total, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  createPost: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.post.create.mutate(input);
      set((state) => ({ posts: [res, ...state.posts], loading: false }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  updatePost: async (input) => {
    set({ loading: true, error: null });
    try {
      const res = await trpc.post.update.mutate(input);
      set((state) => ({
        posts: state.posts.map((p) => (p.id === res.id ? res : p)),
        loading: false,
      }));
      return res;
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },

  deletePost: async (id) => {
    set({ loading: true, error: null });
    try {
      await trpc.post.delete.mutate({ id });
      set((state) => ({
        posts: state.posts.filter((p) => p.id !== id),
        loading: false,
      }));
    } catch (err: any) {
      set({ error: err.message, loading: false });
      throw err;
    }
  },
}));
