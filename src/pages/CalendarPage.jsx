import React from 'react';
import { CalendarDays } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import EmptyState from '../components/common/EmptyState.jsx';

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle="Mark your availability. Hiring team uses this view to schedule interviews."
      />
      <EmptyState
        icon={CalendarDays}
        title="Availability calendar coming in v1.0"
        description="Built on react-big-calendar. Interviewers mark slots; hiring team books into them."
      />
    </>
  );
}
