import type { Post } from "@knowpilot/shared";
import { trpcQuery } from "@/lib/serverTrpc";
import { HeroSection } from "@/components/home/HeroSection";
import { StatsStrip } from "@/components/home/StatsStrip";
import { FeatureBento } from "@/components/home/FeatureBento";
import { TechMarquee } from "@/components/home/TechMarquee";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
import { RacingTrackDivider } from "@/components/home/RacingTrackDivider";
import { FinalCta } from "@/components/home/FinalCta";
import { ScrollProgress } from "@/components/magicui/scroll-progress";

export const metadata = {
  title: "见微 · OasisMind — 本地优先的数字主力",
  description: "见微知著：以 Markdown 为原子、AI 为引擎的本地优先知识花园与数字主力",
};

export default async function HomePage() {
  let recentPosts: { items: Post[]; total: number } = { items: [], total: 0 };
  try {
    recentPosts = await trpcQuery("post.list", { published: true, pageSize: 6 });
  } catch {
    // 构建或离线时降级
  }

  const posts = recentPosts.items ?? [];
  const postCount = recentPosts.total ?? 0;
  const categoryCount = new Set(
    posts.map((p) => p.category).filter(Boolean),
  ).size;

  return (
    <div className="relative shrink-0 overflow-x-hidden">
      <ScrollProgress className="h-0.5 bg-gradient-to-r from-[var(--kp-accent)] via-[var(--kp-brand-light)] to-[var(--kp-brand)]" />
      <HeroSection postCount={postCount} categoryCount={categoryCount} />
      <StatsStrip postCount={postCount} categoryCount={categoryCount} />
      <FeatureBento />
      <TechMarquee />
      <RecentIntelligence posts={posts} />
      <RacingTrackDivider />
      <FinalCta />
    </div>
  );
}
