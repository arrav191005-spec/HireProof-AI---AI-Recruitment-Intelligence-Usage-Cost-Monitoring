import PageHeader from '@/components/layout/PageHeader';
import StudentVerification from '@/components/verification/StudentVerification';

export const metadata = { title: 'My Verification' };

export default function VerificationPage() {
  return (
    <>
      <PageHeader
        title="My Verification"
        description="Register a project, submit a public GitHub repository, and review commit-pinned observations. Verification runs only when the isolated development environment enables it."
      />
      <StudentVerification />
    </>
  );
}
