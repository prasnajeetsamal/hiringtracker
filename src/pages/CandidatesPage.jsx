import React from 'react';
import { Users } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function CandidatesPage() {
  return (
    <>
      <PageHeader
        title="Candidates"
        subtitle="All candidates across roles. Filtering, AI scoring, and CSV export land in v0.5–v1.0."
      />
      <EmptyState
        icon={Users}
        title="Candidate list lives here"
        description="In v0.5 you'll add candidates by uploading a resume or pasting a LinkedIn URL from a role page, and they'll show up here."
      />
    </>
  );
}
