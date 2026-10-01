import { Logo } from "@/components/logo";
import { authMode } from "@/lib/session";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next } = await searchParams;
  const unconfigured = authMode() === "unconfigured";
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>
        <div className="rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow-card)]">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em]">כניסה</h1>
          <p className="mt-1 text-[14px] text-muted">האתר פרטי: יש בו את קורות החיים שלך.</p>
          {unconfigured ? (
            <p className="mt-5 rounded-xl bg-surface-2 p-3 text-[13px] text-muted">
              צריך להגדיר <code dir="ltr">ADMIN_PASSCODE</code> במשתני הסביבה של Vercel ולעשות redeploy.
            </p>
          ) : (
            <LoginForm next={typeof next === "string" ? next : "/"} />
          )}
        </div>
      </div>
    </main>
  );
}
