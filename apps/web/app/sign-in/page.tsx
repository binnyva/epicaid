import { redirect } from "next/navigation";
import { getReader } from "@/lib/auth";
import { figtree } from "../_pocket/font";
import "../_pocket/pocket.css";

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
    <div className={`pocket ${figtree.variable}`}>
      <main className="signed-out">
        <div className="signed-out-inner">
          <span className="wordmark">Epic Aid</span>
          <h1 className="screen-title">Remember who&apos;s who, without spoilers.</h1>
          <p className="body-text muted-text">
            Look up anyone or anything from a long book series and see only what the Chapters you have read reveal.
          </p>
          {error && (
            <p className="notice notice-error" role="alert">
              {errors[error] ?? "Sign-in failed."}
            </p>
          )}
          <a className="button button-primary button-block" href="/api/auth/google">
            Sign in with Google
          </a>
          <p className="secondary">Epic Aid is invite-only for now.</p>
        </div>
      </main>
    </div>
  );
}
