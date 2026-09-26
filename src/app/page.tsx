import { redirect } from "next/navigation";
import { getProfile, HOME_FOR_ROLE } from "@/lib/auth";

export default async function Home() {
  const profile = await getProfile();
  redirect(profile ? HOME_FOR_ROLE[profile.role] : "/login");
}
