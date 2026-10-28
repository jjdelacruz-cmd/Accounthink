import Link from "next/link";
import { StatusScreen, buttonClass } from "@/components/ui";

export default function NotFound() {
  return (
    <StatusScreen
      icon="file"
      title="Page not found"
      actions={
        <Link href="/" className={buttonClass({ className: "px-6" })}>
          Go home
        </Link>
      }
    >
      <p>This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
    </StatusScreen>
  );
}
