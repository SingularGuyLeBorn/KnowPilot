"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface CategoryListProps {
  className?: string;
}

export function CategoryList({ className }: CategoryListProps) {
  const { data: categories, isLoading } = trpc.post.categories.useQuery();

  if (isLoading) {
    return (
      <div className={cn("flex flex-wrap gap-2", className)}>
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-6 w-20 rounded-md" />
        ))}
      </div>
    );
  }

  if (!categories?.length) {
    return (
      <p className={cn("text-sm text-muted-foreground", className)}>
        暂无分类
      </p>
    );
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {categories.map((category) => (
        <Link key={category} href={`/categories/${encodeURIComponent(category)}`}>
          <Badge
            variant="secondary"
            className="cursor-pointer gap-1 px-2.5 py-1 text-xs transition hover:bg-primary/10 hover:text-primary"
          >
            <FolderOpen className="h-3 w-3" />
            {category}
          </Badge>
        </Link>
      ))}
    </div>
  );
}
