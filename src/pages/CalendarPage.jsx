import React from 'react';
import PageHeader from '../components/common/PageHeader.jsx';
import AvailabilityCalendar from '../components/calendar/AvailabilityCalendar.jsx';

export default function CalendarPage() {
  return (
    <>
      <PageHeader
        title="My Availability"
        subtitle="Drag a time block to mark yourself available. Hiring teams use these slots when scheduling interviews."
      />
      <AvailabilityCalendar />
    </>
  );
}
