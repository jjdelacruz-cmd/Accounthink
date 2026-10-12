// Runs every hour on Netlify. Asks the app to email students about exams that open within 24 hours.
// Needs the CRON_SECRET environment variable (same value as the cron_secret row in the database).
export default async () => {
  const base = process.env.URL || process.env.SITE_URL;
  if (!base || !process.env.CRON_SECRET) {
    console.log("reminders: URL or CRON_SECRET missing, nothing to do");
    return;
  }
  const res = await fetch(`${base}/api/cron/reminders`, {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  console.log("reminders:", res.status, await res.text());
};

export const config = { schedule: "@hourly" };
