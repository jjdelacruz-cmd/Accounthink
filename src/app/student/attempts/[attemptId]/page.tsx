import { ExamRunner } from "@/components/ExamRunner";
import { requireRole } from "@/lib/auth";

export default async function AttemptPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  await requireRole("student");
  // Everything else happens client-side: the session is tied to this device/tab.
  return <ExamRunner attemptId={attemptId} />;
}
