import { redirect } from "next/navigation";
import { getReader } from "@/lib/auth";

const errors: Record<string, string> = {
  "not-invited": "That Google account isn't on the invite list yet. Ask the admin to add it.",
  unverified: "Google says that email address isn't verified.",
  state: "The sign-in link expired. Please try again.",
  cancelled: "Sign-in was cancelled.",
  google: "Google sign-in failed. Please try again.",
};

export default async function SignIn({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getReader()) redirect("/");
  const { error } = await searchParams;
  return (
    <main>
      <h1>Epic Aid</h1>
      <p>Remember who&apos;s who in long book series, without spoilers.</p>
      {error && <p className="error">{errors[error] ?? "Sign-in failed."}</p>}
      <p>
        <a className="button" href="/api/auth/google">
          Sign in with Google
        </a>
      </p>
      <p className="muted">Epic Aid is invite-only for now.</p>
    </main>
  );
}
