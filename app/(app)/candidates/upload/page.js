import PageHeader from '@/components/layout/PageHeader';
import { Breadcrumbs, InlineAlert } from '@/components/ui/Feedback';
import { MAX_RESUME_SIZE_MB } from '@/lib/config';
import ResumeUpload from '@/components/candidates/ResumeUpload';
import { Upload } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Upload resume' };

export default function UploadResumePage() {
  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Candidates', href: '/candidates' }, { label: 'Upload resume' }]} />
        }
        title="Upload a resume"
        description="Parse a PDF, review the extracted evidence, then save the profile. Nothing is written to the database until you confirm the review step."
      />
      <ResumeUpload maxSizeMb={MAX_RESUME_SIZE_MB} />
      <div className="mt-5">
        <InlineAlert tone="info" title="How extraction stays honest">
          <p>
            Every extracted skill and evidence record carries the exact excerpt it came from plus its page
            number. If a field could not be located in the document it is left empty rather than guessed —
            you can correct anything before the profile is created.
          </p>
          <p className="mt-1.5">
            The uploaded file is stored server-side, treated as untrusted content, and is never served
            publicly or executed.
          </p>
        </InlineAlert>
      </div>
    </>
  );
}
