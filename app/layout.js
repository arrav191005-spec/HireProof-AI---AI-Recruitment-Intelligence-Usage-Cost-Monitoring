import './globals.css';

export const metadata = {
  title: {
    default: 'HireProof AI',
    template: '%s · HireProof AI',
  },
  description:
    'Evidence-based recruitment intelligence: job management, candidate search with source-grounded evidence, and skill assessments.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
