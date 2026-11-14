import Link from "next/link";
import { requireReader } from "@/lib/auth";

export default async function Home() {
  const reader = await requireReader();
  return (
    <main>
      <h1>Epic Aid</h1>
      <p>Hello{reader.name ? `, ${reader.name}` : ""}. Remember who&apos;s who in long book series, without spoilers.</p>
      <p className="muted">The reader app arrives in Phase 3.</p>
      {reader.isAdmin && (
        <p>
          <Link href="/admin">Admin</Link>
        </p>
      )}
      <form action="/api/auth/sign-out" method="post">
        <button type="submit" className="link">
          Sign out
        </button>
      </form>
    </main>
  );
}
