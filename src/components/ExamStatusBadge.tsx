import { Badge, type BadgeTone } from "@/components/ui";

const TONE: Record<"draft" | "published" | "closed", BadgeTone> = {
  draft: "neutral",
  published: "success",
  closed: "danger",
};

const LABEL = { draft: "Draft", published: "Published", closed: "Closed" } as const;

export function ExamStatusBadge({ status }: { status: keyof typeof TONE }) {
  return (
    <Badge tone={TONE[status]} className="shrink-0">
      {LABEL[status]}
    </Badge>
  );
}
