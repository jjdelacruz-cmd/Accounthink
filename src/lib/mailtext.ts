import { siteUrl, type Mail } from "@/lib/mail";
import { formatManila } from "@/lib/time";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(title: string, bodyHtml: string, path = "/student") {
  const url = siteUrl();
  const link = url ? `<p><a href="${url}${path}" style="display:inline-block;background:#047857;color:#fff;padding:10px 18px;border-radius:10px;text-decoration:none;font-weight:600">Open Accounthink</a></p>` : "";
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;color:#0f172a">
<p style="color:#047857;font-weight:700;font-size:12px;letter-spacing:.05em;margin-bottom:0">ACCOUNTHINK · OLFU CBA</p>
<h2 style="margin-top:4px">${esc(title)}</h2>${bodyHtml}${link}
<p style="color:#64748b;font-size:12px;margin-top:24px">You get this because you are in this class. You can turn emails off under Account in Accounthink.</p></div>`;
}

const footer = (path = "/student") => (siteUrl() ? `\n\nOpen Accounthink: ${siteUrl()}${path}` : "");
const optOut = "\n\nYou can turn these emails off under Account in Accounthink.";

export function announcementMail(course: string, title: string, body: string): Mail {
  return {
    subject: `[${course}] ${title}`,
    text: `${course} · announcement\n\n${title}\n\n${body}${footer()}${optOut}`,
    html: wrap(`${title}`, `<p style="color:#64748b;margin-top:0">${esc(course)}</p><p style="white-space:pre-line">${esc(body)}</p>`),
  };
}

type ExamInfo = { title: string; course: string; opens_at: string | null; closes_at: string | null; minutes: number | null };

function examLines(e: ExamInfo) {
  const l: string[] = [];
  l.push(e.opens_at ? `Opens: ${formatManila(e.opens_at)} (PH time)` : "Opens: as soon as your instructor opens it");
  if (e.closes_at) l.push(`Closes: ${formatManila(e.closes_at)} (PH time)`);
  if (e.minutes) l.push(`Time limit: ${e.minutes} minutes`);
  return l;
}

export function newExamMail(e: ExamInfo): Mail {
  const lines = examLines(e);
  return {
    subject: `[${e.course}] New exam: ${e.title}`,
    text: `${e.course}\n\nYour instructor scheduled an exam: ${e.title}\n\n${lines.join("\n")}\n\nUse your own phone and a stable connection. You can take it only once.${footer()}${optOut}`,
    html: wrap(`New exam: ${e.title}`, `<p style="color:#64748b;margin-top:0">${esc(e.course)}</p><p>${lines.map(esc).join("<br>")}</p><p>Use your own phone and a stable connection. You can take it only once.</p>`),
  };
}

export function reminderMail(e: ExamInfo): Mail {
  const lines = examLines(e);
  return {
    subject: `[${e.course}] Reminder: ${e.title} opens soon`,
    text: `${e.course}\n\nReminder: ${e.title} opens soon.\n\n${lines.join("\n")}\n\nCharge your phone and check your connection.${footer()}${optOut}`,
    html: wrap(`Reminder: ${e.title} opens soon`, `<p style="color:#64748b;margin-top:0">${esc(e.course)}</p><p>${lines.map(esc).join("<br>")}</p><p>Charge your phone and check your connection.</p>`),
  };
}

export type ScoreUpdateInfo = {
  name: string;
  course: string;
  exam: string;
  oldScore: number | null;
  newScore: number;
  maxScore: number;
  byHand: boolean;
};

/** "Your score was updated" for one student (sent alone, since the numbers are personal). */
export function scoreUpdateMail(u: ScoreUpdateInfo): Mail {
  const change = u.oldScore === null ? `${u.newScore} / ${u.maxScore}` : `${u.oldScore} → ${u.newScore} / ${u.maxScore}`;
  const why = u.byHand
    ? "Your instructor checked or adjusted your answers."
    : "Scores were re-graded after the answer key was corrected.";
  const hello = u.name ? `Hi ${u.name.split(",").pop()!.trim().split(" ")[0]},` : "Hi,";
  return {
    subject: `[${u.course}] Your score in ${u.exam} was updated`,
    text: `${hello}\n\n${u.course} · ${u.exam}\nYour score: ${change}\n\n${why}${footer()}${optOut}`,
    html: wrap(
      `Your score was updated`,
      `<p style="color:#64748b;margin-top:0">${esc(u.course)} · ${esc(u.exam)}</p>
<p style="font-size:26px;font-weight:700;margin:8px 0">${u.oldScore === null ? "" : `<span style="color:#94a3b8;text-decoration:line-through">${u.oldScore}</span> → `}${u.newScore} <span style="font-size:16px;color:#64748b;font-weight:400">/ ${u.maxScore}</span></p>
<p>${esc(why)}</p>`,
    ),
  };
}

export function testMail(): Mail {
  return {
    subject: "Accounthink test email",
    text: `If you can read this, Accounthink can send email.${footer("/")}`,
    html: wrap("Test email", "<p>If you can read this, Accounthink can send email.</p>", "/"),
  };
}
