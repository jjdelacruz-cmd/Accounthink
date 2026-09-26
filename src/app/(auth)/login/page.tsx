import { LoginForm } from "../AuthForms";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <LoginForm confirmError={error === "confirm"} />;
}
