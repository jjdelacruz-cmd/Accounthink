"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { duplicateItem } from "@/app/actions/items";

export function DuplicateItemButton({ itemId, courseId }: { itemId: string; courseId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await duplicateItem(itemId);
          if (res.error) alert(res.error);
          else router.push(`/instructor/courses/${courseId}/items/${res.id}`);
        })
      }
      className="btn btn-secondary btn-sm"
    >
      {pending ? "Copying…" : "Duplicate"}
    </button>
  );
}
