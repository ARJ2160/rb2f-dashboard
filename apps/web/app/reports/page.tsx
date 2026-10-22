'use client';

import Link from 'next/link';

import { ReportsDashboard } from '@/components/reports-dashboard';
import { useProfile } from '@/lib/profile';

export default function ReportsPage() {
  const { profileId } = useProfile();
  return (
    <ReportsDashboard
      profileId={profileId}
      emptyState={
        <>
          No data for this profile yet.{' '}
          <Link href="/upload" className="font-medium text-accent underline">
            Upload reports
          </Link>{' '}
          to get started.
        </>
      }
    />
  );
}
