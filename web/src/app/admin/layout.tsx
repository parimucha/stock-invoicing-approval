import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin, signOutAdmin } from "@/lib/auth";

async function logout() {
  "use server";
  await signOutAdmin();
  redirect("/login");
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/login");

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link href="/admin" className="font-semibold">
              Stock invoicing
            </Link>
            <nav className="text-sm text-neutral-600 flex gap-4">
              <Link href="/admin" className="hover:text-neutral-900">
                Reports
              </Link>
              <Link href="/admin/upload" className="hover:text-neutral-900">
                Upload
              </Link>
              <Link href="/admin/analytics" className="hover:text-neutral-900">
                Analytics
              </Link>
            </nav>
          </div>
          <form action={logout}>
            <button className="text-sm text-neutral-600 hover:text-neutral-900">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-6">{children}</main>
    </div>
  );
}
