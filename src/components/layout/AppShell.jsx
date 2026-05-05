// src/components/layout/AppShell.jsx
import React from 'react';
import { Routes, Route } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import UserMenu from './UserMenu.jsx';

import DashboardPage from '../../pages/DashboardPage.jsx';
import ProjectsPage from '../../pages/ProjectsPage.jsx';
import ProjectDetailPage from '../../pages/ProjectDetailPage.jsx';
import RoleDetailPage from '../../pages/RoleDetailPage.jsx';
import CandidatesPage from '../../pages/CandidatesPage.jsx';
import CandidateDetailPage from '../../pages/CandidateDetailPage.jsx';
import CalendarPage from '../../pages/CalendarPage.jsx';
import MyInterviewsPage from '../../pages/MyInterviewsPage.jsx';
import JDTemplatesPage from '../../pages/JDTemplatesPage.jsx';
import SettingsPage from '../../pages/SettingsPage.jsx';
import NotFoundPage from '../../pages/NotFoundPage.jsx';

export default function AppShell() {
  return (
    <div className="min-h-screen flex text-slate-200">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 border-b border-slate-800/80 bg-slate-950/40 backdrop-blur flex items-center justify-end px-4 sticky top-0 z-30">
          <UserMenu />
        </header>
        <main className="flex-1 min-w-0 p-6">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/projects/:projectId/roles/:roleId" element={<RoleDetailPage />} />
            <Route path="/candidates" element={<CandidatesPage />} />
            <Route path="/candidates/:candidateId" element={<CandidateDetailPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/my-interviews" element={<MyInterviewsPage />} />
            <Route path="/jd-templates" element={<JDTemplatesPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
