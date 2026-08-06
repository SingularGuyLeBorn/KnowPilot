import type { Garden, Post } from "@knowpilot/shared";
import { trpcQuery } from "@/lib/serverTrpc";
import { HeroSection } from "@/components/home/HeroSection";
import { StatsStrip } from "@/components/home/StatsStrip";
import {
  ArticleUpdateCalendar,
  type ActivityCalendarData,
} from "@/components/home/ArticleUpdateCalendar";
import { FeatureBento } from "@/components/home/FeatureBento";
import { GardenCardOrganizer } from "@/components/home/GardenCardOrganizer";
import { AgentConversationDemo } from "@/components/home/AgentConversationDemo";
import { TechMarquee } from "@/components/home/TechMarquee";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
import { FinalCta } from "@/components/home/FinalCta";
import { ScrollProgress } from "@/components/magicui/scroll-progress";

export const metadata = {
  title: "见微 · OasisMind — 本地优先的数字主力",
  description: "见微知著：以 Markdown 为原子、AI 为引擎的本地优先知识花园与数字主力",
};

export default async function HomePage() {
  let recentPosts: { items: Post[]; total: number } = { items: [], total: 0 };
  let gardens: Garden[] = [];
  let activity: ActivityCalendarData | null = null;
  try {
    const [postsRes, gardensRes, activityRes] = await Promise.all([
      trpcQuery<{ items: Post[]; total: number }>("post.list", {
        published: true,
        pageSize: 6,
      }),
      trpcQuery<{ items: Garden[] }>("garden.list", { page: 1, pageSize: 8 }),
      trpcQuery<ActivityCalendarData>("post.activityCalendar", {
        weeks: 53,
        publishedOnly: true,
      }),
    ]);
    recentPosts = postsRes;
    gardens = gardensRes.items ?? [];
    activity = activityRes;
  } catch {
    // 构建或离线时降级
  }

  const posts = recentPosts.items ?? [];
  const postCount = recentPosts.total ?? 0;
  const categoryCount = new Set(
    posts.map((p) => p.category).filter(Boolean),
  ).size;

  return (
    <div className="kp-force-light relative shrink-0 overflow-x-hidden">
      <ScrollProgress className="h-0.5 bg-gradient-to-r from-[var(--kp-glow-peach)] via-[var(--kp-brand-light)] to-[var(--kp-brand)]" />
      <HeroSection />
      <div className="pb-4 pt-2">
        <StatsStrip postCount={postCount} categoryCount={categoryCount} />
      </div>
      <ArticleUpdateCalendar data={activity} />
      <GardenCardOrganizer gardens={gardens} />
      <FeatureBento />
      <AgentConversationDemo />
      <TechMarquee />
      <RecentIntelligence posts={posts} />
      <FinalCta />
    </div>
  );
}
