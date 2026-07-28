import { AuthGuard } from '@/components/AuthGuard';
import { ProjectShell } from '@/components/ProjectShell';

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <ProjectShell>{children}</ProjectShell>
    </AuthGuard>
  );
}
