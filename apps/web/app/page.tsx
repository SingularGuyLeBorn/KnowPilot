"use client";

import dynamic from "next/dynamic";
import { HeroSection } from "@/components/home/HeroSection";
import { trpc } from "@/lib/trpc";

/** below-fold：首屏只 hydrate Hero，滚动区再拆包 */
const FeatureBento = dynamic(
  () => import("@/components/home/FeatureBento").then((m) => m.FeatureBento),
  { ssr: true, loading: () => <div className="min-h-[28rem]" aria-hidden /> },
);
const TechMarquee = dynamic(
  () => import("@/components/home/TechMarquee").then((m) => m.TechMarquee),
  { ssr: true, loading: () => <div className="min-h-16" aria-hidden /> },
);
const RecentIntelligence = dynamic(
  () => import("@/components/home/RecentIntelligence").then((m) => m.RecentIntelligence),
  { ssr: true, loading: () => <div className="min-h-[24rem]" aria-hidden /> },
);
const FinalCta = dynamic(
  () => import("@/components/home/FinalCta").then((m) => m.FinalCta),
  { ssr: true, loading: () => <div className="min-h-[16rem]" aria-hidden /> },
);

export default function HomePage() {
  const { data: recentPosts } = trpc.post.list.useQuery({
    published: true,
    pageSize: 6,
  });

  const posts = recentPosts?.items ?? [];
  const postCount = recentPosts?.total ?? 0;
  // Hero 分类数：用当前页推导即可，避免为计数再拉 pageSize:100
  const categoryCount = new Set(
    recentPosts?.items.map((p) => p.category).filter(Boolean) ?? [],
  ).size;

  return (
    <div className="relative">
      <HeroSection postCount={postCount} categoryCount={categoryCount} />
      <FeatureBento />
      <TechMarquee />
      <RecentIntelligence posts={posts} />
      <FinalCta />
    </div>
  );
}
