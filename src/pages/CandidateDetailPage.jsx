import React from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import EmptyState from '../components/common/EmptyState.jsx';
import { Users } from 'lucide-react';

export default function CandidateDetailPage() {
  const { candidateId } = useParams();
  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/candidates" className="inline-flex items-center gap-1 hover:text-slate-300">
            <ArrowLeft size={11} /> All candidates
          </Link>
        }
        title="Candidate"
        subtitle={`ID: ${candidateId}`}
      />
      <EmptyState
        icon={Users}
        title="Candidate detail UI coming in v0.5"
        description="Resume preview, timeline, per-round interviewers, feedback, and advance/reject controls."
      />
    </>
  );
}
