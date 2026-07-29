import { AuthGuard } from '@/components/AuthGuard';
import { DashboardTopbar } from '@/components/DashboardTopbar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-paper">
        <DashboardTopbar />
        <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      </div>
    </AuthGuard>
  );
}
