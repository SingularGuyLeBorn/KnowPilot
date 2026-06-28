"use client";

import { Shell } from "@/components/layout/Shell";
import { HeroSection } from "@/components/home/HeroSection";
import { FeatureBento } from "@/components/home/FeatureBento";
import { TechMarquee } from "@/components/home/TechMarquee";
import { RecentIntelligence } from "@/components/home/RecentIntelligence";
import { FinalCta } from "@/components/home/FinalCta";
import { trpc } from "@/lib/trpc";

export default function HomePage() {
  const { data: recentPosts, isLoading } = trpc.post.list.useQuery({
    published: true,
    pageSize: 100,
  });

  const posts = recentPosts?.items.slice(0, 6) ?? [];
  const postCount = recentPosts?.total ?? 0;
  const categoryCount = new Set(
    recentPosts?.items.map((p) => p.category).filter(Boolean) ?? []
  ).size;

  return (
    <Shell className="overflow-x-hidden">
      <div className="relative">
        <HeroSection postCount={postCount} categoryCount={categoryCount} />
        <FeatureBento />
        <TechMarquee />
        <RecentIntelligence posts={posts} />
        <FinalCta />
      </div>
    </Shell>
  );
}
