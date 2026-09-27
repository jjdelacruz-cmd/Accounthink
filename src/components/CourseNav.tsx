import Link from "next/link";

export function CourseNav({
  course,
  active,
}: {
  course: { id: string; code: string; title: string };
  active: "items" | "exams" | "students";
}) {
  const tab = (key: "items" | "exams" | "students", label: string) => (
    <Link
      href={`/instructor/courses/${course.id}/${key}`}
      className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-semibold ${
        active === key ? "bg-white text-emerald-800 shadow-sm" : "text-slate-600"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="space-y-3">
      <Link href="/instructor" className="text-sm font-medium text-emerald-700">
        ← My courses
      </Link>
      <div>
        <p className="text-sm font-semibold text-emerald-700">{course.code}</p>
        <h1 className="text-xl font-bold">{course.title}</h1>
      </div>
      <nav className="flex gap-1 rounded-xl bg-slate-200/70 p-1">
        {tab("items", "Item bank")}
        {tab("exams", "Exams")}
        {tab("students", "Students")}
      </nav>
    </div>
  );
}
