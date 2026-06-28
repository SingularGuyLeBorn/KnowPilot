"use client";

import Link from "next/link";
import { Hash } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface TagCloudProps {
  className?: string;
  limit?: number;
}

export function TagCloud({ className, limit }: TagCloudProps) {
  const { data: tags, isLoading } = trpc.post.tags.useQuery();

  const displayTags = limit && tags ? tags.slice(0, limit) : tags;

  if (isLoading) {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-16 rounded-full" />
        ))}
      </div>
    );
  }

  if (!displayTags?.length) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        暂无标签
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {displayTags.map((tag) => (
        <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`}>
          <Badge
            variant="outline"
            className="cursor-pointer gap-1 px-2.5 py-1 text-xs transition hover:border-primary/50 hover:bg-primary/5 hover:text-primary"
          >
            <Hash className="h-3 w-3" />
            {tag}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
