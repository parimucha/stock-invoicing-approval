import { redirect } from "next/navigation";
import { signInAdmin, isAdmin } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const password = String(formData.get("password") ?? "");
  const ok = await signInAdmin(password);
  if (!ok) redirect("/login?error=1");
  redirect("/admin");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await isAdmin()) redirect("/admin");
  const { error } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-neutral-50">
      <form
        action={login}
        className="bg-white border border-neutral-200 rounded-lg shadow-sm p-8 w-full max-w-sm space-y-4"
      >
        <h1 className="text-xl font-semibold">PORTA admin</h1>
        <p className="text-sm text-neutral-600">
          Sign in to manage Stock invoicing reports.
        </p>
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
            Wrong password.
          </div>
        )}
        <label className="block">
          <span className="text-sm text-neutral-700">Password</span>
          <input
            type="password"
            name="password"
            required
            autoFocus
            className="mt-1 w-full border border-neutral-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </label>
        <button
          type="submit"
          className="w-full bg-neutral-900 text-white rounded px-3 py-2 hover:bg-neutral-800"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
