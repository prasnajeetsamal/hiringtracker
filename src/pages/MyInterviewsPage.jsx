import React from 'react';
import { ClipboardCheck } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function MyInterviewsPage() {
  return (
    <>
      <PageHeader
        title="My Interviews"
        subtitle="Your upcoming interviewer assignments and pending feedback."
      />
      <EmptyState
        icon={ClipboardCheck}
        title="No assignments yet"
        description="When hiring teams assign you as an interviewer, your scheduled interviews and pending feedback appear here."
      />
    </>
  );
}
