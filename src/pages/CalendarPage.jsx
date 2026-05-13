import React, { useState } from 'react';
import { CalendarDays, Users } from 'lucide-react';
import PageHeader from '../components/common/PageHeader.jsx';
import AvailabilityCalendar from '../components/calendar/AvailabilityCalendar.jsx';
import TeamAvailabilityCalendar from '../components/calendar/TeamAvailabilityCalendar.jsx';

const TABS = [
  { id: 'mine', label: 'My availability', icon: CalendarDays },
  { id: 'team', label: 'Team availability', icon: Users },
];

export default function CalendarPage() {
  const [tab, setTab] = useState('mine');

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={
          tab === 'mine'
            ? 'Drag a time block to mark yourself available. Hiring teams use these slots when scheduling interviews.'
            : 'Everyone\'s availability - filter by interviewer to find a common slot.'
        }
      />
      <div className="flex rounded-lg bg-slate-800/60 p-0.5 text-sm border border-slate-700 mb-4 max-w-md">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-1.5 rounded-md transition flex items-center justify-center gap-1.5 ${
              tab === id ? 'bg-slate-700 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {tab === 'mine' ? <AvailabilityCalendar /> : <TeamAvailabilityCalendar />}
    </>
  );
}
