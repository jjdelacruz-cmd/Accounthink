import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { StudentNav } from "@/components/StudentNav";
import { Badge, Card, EmptyState, PageTitle } from "@/components/ui";
import { requireRole } from "@/lib/auth";
import { KIND_LABEL } from "@/lib/exams";
import { groupMyScores, type MyScore } from "@/lib/myScores";
import { createClient } from "@/lib/supabase/server";
import { formatManila } from "@/lib/time";

export default async function MyScoresPage() {
  const profile = await requireRole("student");
  const supabase = await createClient();
  const { data } = await supabase.rpc("my_scores");
  const courses = groupMyScores((data ?? []) as MyScore[]);

  return (
    <AppShell profile={profile}>
      <StudentNav active="scores" />
      <PageTitle>My scores</PageTitle>
      {courses.length === 0 ? (
        <EmptyState icon="chart" title="No scores yet">
          Your exam scores will show here once you take an exam.
        </EmptyState>
      ) : (
        courses.map((c) => (
          <Card key={c.code} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-brand-700">{c.code}</p>
                <h2 className="text-heading font-semibold">{c.title}</h2>
                <p className="text-sm text-ink-600">{c.section}</p>
              </div>
              {c.average !== null && (
                <div className="shrink-0 text-right">
                  <p className="text-2xl font-bold tabular-nums text-brand-800">{Math.round(c.average)}%</p>
                  <p className="text-xs text-ink-600">average</p>
                </div>
              )}
            </div>
            <ul className="space-y-2">
              {c.rows.map((r) => (
                <li key={r.exam_id}>
                  <Link href={`/student/exams/${r.exam_id}`} className="row-link">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold">{r.title}</p>
                        <p className="text-xs text-ink-600">
                          {KIND_LABEL[r.kind] ?? r.kind}
                          {r.submitted_at ? ` · submitted ${formatManila(r.submitted_at)}` : ""}
                        </p>
                      </div>
                      <ScoreCell row={r} />
                    </div>
                    {r.pending > 0 && r.released && (
                      <p className="mt-1 text-xs text-warning-800">
                        {r.pending} answer{r.pending === 1 ? "" : "s"} still being checked, so this may go up.
                      </p>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}
    </AppShell>
  );
}

function ScoreCell({ row: r }: { row: MyScore }) {
  if (r.score !== null && r.max_score !== null) {
    const max = Number(r.max_score);
    return (
      <div className="shrink-0 text-right">
        <p className="text-lg font-bold tabular-nums">
          {Number(r.score)}
          <span className="text-sm font-medium text-ink-600"> / {max}</span>
        </p>
        <p className="text-xs font-semibold tabular-nums text-brand-800">
          {Math.round((Number(r.score) / Math.max(max, 1)) * 100)}%
        </p>
      </div>
    );
  }
  if (r.submitted_at) return <Badge tone="neutral">Not released</Badge>;
  if (r.started) return <Badge tone="warning">In progress</Badge>;
  return <Badge tone={r.status === "published" ? "success" : "neutral"}>{r.status === "published" ? "Not taken yet" : "Missed"}</Badge>;
}
