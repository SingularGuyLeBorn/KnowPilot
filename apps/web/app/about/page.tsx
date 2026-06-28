import { AboutView } from "@/components/about/AboutView";
import { trpcQuery } from "@/lib/serverTrpc";
import type { AboutProfile } from "@knowpilot/shared";

export const metadata = {
  title: "About Me | KnowPilot",
  description: "关于 KnowPilot 作者 SingularGuyLeBorn — AI 工程与知识管理",
};

export const dynamic = "force-dynamic";

const FALLBACK_PROFILE: AboutProfile = {
  name: "KnowPilot",
  title: "Creator",
  tagline: "",
  location: "",
  github: "",
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
