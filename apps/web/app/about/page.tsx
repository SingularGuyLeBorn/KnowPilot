import { AboutView } from "@/components/about/AboutView";
import { trpcQuery } from "@/lib/serverTrpc";
import type { AboutProfile } from "@knowpilot/shared";

export const metadata = {
  title: "关于应知序 | 见微 · OasisMind",
  description: "应知序 — 粗鄙、偏颇，但还有点梦想。见微知著，本地优先的数字主力。",
};

export const dynamic = "force-dynamic";

const FALLBACK_PROFILE: AboutProfile = {
  name: "应知序",
  title: "粗鄙 · 偏颇 · 还有点梦想",
  tagline: "写代码不是目的，做出东西才是。",
  location: "",
  github: "https://github.com/SingularGuyLeBorn",
  site: "",
  email: "",
  focus: [],
  stack: [],
  projects: [],
  philosophy: [],
  bodyMarkdown: "About profile 暂不可用，请确认后端已启动。",
};

export default async function AboutPage() {
  let profile = FALLBACK_PROFILE;
  try {
    profile = await trpcQuery<AboutProfile>("about.getProfile");
  } catch {
    /* 构建或离线时降级 */
  }
  return <AboutView profile={profile} />;
}
