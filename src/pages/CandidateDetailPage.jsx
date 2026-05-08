import React, { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, X, SkipForward, Sparkles, Linkedin, Mail, Phone,
  FileText, Wand2, MessageSquare, Trash2, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';

import PageHeader from '../components/common/PageHeader.jsx';
import Card from '../components/common/Card.jsx';
import Button from '../components/common/Button.jsx';
import Spinner from '../components/common/Spinner.jsx';
import ConfirmDialog from '../components/common/ConfirmDialog.jsx';
import StageBadge from '../components/candidates/StageBadge.jsx';
import RecommendationBadge from '../components/candidates/RecommendationBadge.jsx';
import InterviewerAssignment from '../components/candidates/InterviewerAssignment.jsx';
import ConsiderForRoleDialog from '../components/candidates/ConsiderForRoleDialog.jsx';
import ResumeView from '../components/candidates/ResumeView.jsx';
import FeedbackForm from '../components/feedback/FeedbackForm.jsx';
import FeedbackTimeline from '../components/feedback/FeedbackTimeline.jsx';
import CommentThread from '../components/comments/CommentThread.jsx';

import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { scoreCandidate, summarizeFeedback, deleteCandidate } from '../lib/api.js';
import { STAGE_BY_KEY, enabledStages } from '../lib/pipeline.js';

export default function CandidateDetailPage() {
  const { candidateId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [considerOpen, setConsiderOpen] = useState(false);

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select(`
          id, full_name, email, phone, linkedin_url, resume_text, resume_file_id,
          source, current_stage_key, status, ai_score, ai_analysis, role_id, created_at,
          role:roles ( id, title, project_id, stage_config,
            project:hiring_projects ( id, name )
          )
        `)
        .eq('id', candidateId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: pipeline } = useQuery({
    queryKey: ['candidate-pipeline', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidate_pipeline')
        .select('id, stage_key, stage_order, state, started_at, completed_at')
        .eq('candidate_id', candidateId)
        .order('stage_order');
      if (error) throw error;
      return data;
    },
  });

  // Determine "my pipeline rows" — rows where I'm assigned as interviewer
  const pipelineIds = (pipeline || []).map((p) => p.id);
  const { data: myAssignments } = useQuery({
    queryKey: ['my-assignments-for-candidate', candidateId, pipelineIds.join(',')],
    enabled: !!user && pipelineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('interviewer_assignments')
        .select('id, pipeline_id')
        .eq('interviewer_id', user.id)
        .in('pipeline_id', pipelineIds);
      if (error) throw error;
      return data;
    },
  });
  const myAssignedPipelines = new Set((myAssignments || []).map((a) => a.pipeline_id));

  // My existing feedback rows (so the form can pre-populate)
  const { data: myFeedback } = useQuery({
    queryKey: ['my-feedback', candidateId, pipelineIds.join(',')],
    enabled: !!user && pipelineIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('feedback')
        .select('id, pipeline_id, recommendation, rating, body_html')
        .eq('interviewer_id', user.id)
        .in('pipeline_id', pipelineIds);
      if (error) throw error;
      return data;
    },
  });
  const myFeedbackByPipeline = Object.fromEntries((myFeedback || []).map((f) => [f.pipeline_id, f]));

  const advance = useMutation({
    mutationFn: async () => {
      if (!candidate || !pipeline) throw new Error('Loading…');
      const cfg = candidate.role?.stage_config;
      const enabled = enabledStages(cfg);
      const currentIdx = enabled.findIndex((s) => s.key === candidate.current_stage_key);
      const next = enabled[currentIdx + 1];

      // Mark current pipeline row 'passed'
      const currentRow = pipeline.find((p) => p.stage_key === candidate.current_stage_key);
      if (currentRow) {
        await supabase
          .from('candidate_pipeline')
          .update({ state: 'passed', completed_at: new Date().toISOString(), decided_by: user.id })
          .eq('id', currentRow.id);
      }
      if (!next) {
        // Final stage passed → mark hired
        await supabase.from('candidates').update({ status: 'hired' }).eq('id', candidateId);
        return;
      }
      // Mark next pipeline row 'in_progress'
      const nextRow = pipeline.find((p) => p.stage_key === next.key);
      if (nextRow) {
        await supabase
          .from('candidate_pipeline')
          .update({ state: 'in_progress', started_at: new Date().toISOString() })
          .eq('id', nextRow.id);
      }
      await supabase.from('candidates').update({ current_stage_key: next.key }).eq('id', candidateId);
    },
    onSuccess: () => {
      toast.success('Advanced');
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate-pipeline', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates', candidate?.role_id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const reject = useMutation({
    mutationFn: async () => {
      const currentRow = pipeline?.find((p) => p.stage_key === candidate.current_stage_key);
      if (currentRow) {
        await supabase
          .from('candidate_pipeline')
          .update({ state: 'failed', completed_at: new Date().toISOString(), decided_by: user.id })
          .eq('id', currentRow.id);
      }
      await supabase.from('candidates').update({ status: 'rejected' }).eq('id', candidateId);
    },
    onSuccess: () => {
      toast.success('Candidate rejected');
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate-pipeline', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates', candidate?.role_id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const skip = useMutation({
    mutationFn: async () => {
      const cfg = candidate.role?.stage_config;
      const enabled = enabledStages(cfg);
      const currentIdx = enabled.findIndex((s) => s.key === candidate.current_stage_key);
      const next = enabled[currentIdx + 1];
      const currentRow = pipeline.find((p) => p.stage_key === candidate.current_stage_key);
      if (currentRow) {
        await supabase
          .from('candidate_pipeline')
          .update({ state: 'skipped', completed_at: new Date().toISOString(), decided_by: user.id })
          .eq('id', currentRow.id);
      }
      if (next) {
        const nextRow = pipeline.find((p) => p.stage_key === next.key);
        if (nextRow) {
          await supabase
            .from('candidate_pipeline')
            .update({ state: 'in_progress', started_at: new Date().toISOString() })
            .eq('id', nextRow.id);
        }
        await supabase.from('candidates').update({ current_stage_key: next.key }).eq('id', candidateId);
      } else {
        await supabase.from('candidates').update({ status: 'hired' }).eq('id', candidateId);
      }
    },
    onSuccess: () => {
      toast.success('Stage skipped');
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidate-pipeline', candidateId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const score = useMutation({
    mutationFn: async () => {
      return scoreCandidate({ candidateId, roleId: candidate.role_id });
    },
    onSuccess: () => {
      toast.success('AI scored the resume');
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const summarize = useMutation({
    mutationFn: async () => summarizeFeedback({ candidateId }),
    onSuccess: () => {
      toast.success('Committee brief generated');
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
    },
    onError: (e) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async () => deleteCandidate({ candidateId }),
    onSuccess: () => {
      toast.success('Candidate deleted');
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
      qc.invalidateQueries({ queryKey: ['candidates', candidate?.role_id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(candidate?.role?.project_id && candidate?.role_id
        ? `/projects/${candidate.role.project_id}/roles/${candidate.role_id}`
        : '/candidates');
    },
    onError: (e) => toast.error(e.message),
  });

  // Sibling candidates (same person on other roles) — match by email when set.
  const { data: siblings } = useQuery({
    queryKey: ['siblings', candidate?.email, candidateId],
    enabled: !!candidate?.email,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select(`id, full_name, current_stage_key, status,
          role:roles ( id, title, project_id, project:hiring_projects ( id, name ) )`)
        .eq('email', candidate.email)
        .neq('id', candidateId);
      if (error) throw error;
      return data;
    },
  });

  if (isLoading) return <Spinner />;
  if (!candidate) return <div className="text-slate-400">Candidate not found.</div>;

  const isTerminal = candidate.status === 'rejected' || candidate.status === 'hired';
  const ai = candidate.ai_analysis;
  const brief = ai?.committee_brief;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to={`/projects/${candidate.role?.project_id}/roles/${candidate.role_id}`} className="inline-flex items-center gap-1 hover:text-slate-300">
            <ArrowLeft size={11} /> {candidate.role?.title || 'Role'}
          </Link>
        }
        title={candidate.full_name || 'Unnamed candidate'}
        subtitle={
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-400">{candidate.role?.project?.name}</span>
            {candidate.status === 'rejected' && (
              <span className="text-rose-300 text-xs px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/30">Rejected</span>
            )}
            {candidate.status === 'hired' && (
              <span className="text-emerald-300 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30">Hired</span>
            )}
          </span>
        }
        actions={
          <>
            <Button variant="ghost" icon={Copy} onClick={() => setConsiderOpen(true)}>Consider for another role</Button>
            {!isTerminal && (
              <>
                <Button variant="ghost" icon={SkipForward} onClick={() => skip.mutate()} loading={skip.isPending}>Skip stage</Button>
                <Button variant="danger" icon={X} onClick={() => reject.mutate()} loading={reject.isPending}>Reject</Button>
                <Button icon={ArrowRight} onClick={() => advance.mutate()} loading={advance.isPending}>Advance</Button>
              </>
            )}
            {isAdmin && (
              <Button variant="danger" icon={Trash2} onClick={() => setConfirmDeleteOpen(true)}>Delete</Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* AI evaluation */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <Sparkles size={16} className="text-indigo-300" /><span className="font-medium">AI evaluation</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={Wand2}
                onClick={() => score.mutate()}
                loading={score.isPending}
                disabled={!candidate.resume_text}
                title={!candidate.resume_text ? 'AI scoring needs an uploaded resume' : 'Score this candidate against the JD'}
              >
                {ai ? 'Re-score' : 'Score against JD'}
              </Button>
            </div>
            {!candidate.resume_text ? (
              <div className="text-sm text-slate-400">
                AI scoring is unavailable for LinkedIn-only candidates. Upload a resume to enable it.
              </div>
            ) : !ai ? (
              <div className="text-sm text-slate-400">
                Click <strong>Score against JD</strong> to have Claude evaluate the resume against this role's JD.
              </div>
            ) : (
              <AIEvaluation ai={ai} />
            )}
          </Card>

          {/* Pipeline timeline + per-stage interviewer assignment */}
          <Card>
            <div className="text-slate-200 font-medium mb-3">Pipeline</div>
            <div className="space-y-3">
              {(pipeline || []).map((p) => {
                const stage = STAGE_BY_KEY[p.stage_key];
                const isCurrent = p.stage_key === candidate.current_stage_key && !isTerminal;
                const stageEnabledCfg = candidate.role?.stage_config?.find((c) => c.stage_key === p.stage_key);
                return (
                  <div
                    key={p.id}
                    className={`rounded-lg border px-3 py-2.5 ${
                      isCurrent ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'
                    }`}
                  >
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{stage?.label || p.stage_key}</span>
                        <StageBadge stageKey={p.stage_key} state={p.state} size="sm" />
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {p.completed_at ? `Completed ${new Date(p.completed_at).toLocaleDateString()}` :
                         p.started_at ? `Started ${new Date(p.started_at).toLocaleDateString()}` : ''}
                      </span>
                    </div>
                    {stageEnabledCfg?.what_to_expect && (
                      <div className="text-xs text-slate-400 mt-1">{stageEnabledCfg.what_to_expect}</div>
                    )}
                    {/* Interviewer assignments + own feedback form */}
                    {p.state !== 'skipped' && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-800/60">
                        <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Interviewers</div>
                        <InterviewerAssignment pipelineId={p.id} />
                        {myAssignedPipelines.has(p.id) && (
                          <div className="mt-3 pt-3 border-t border-slate-800/60">
                            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">Your feedback</div>
                            <FeedbackForm
                              pipelineId={p.id}
                              interviewerId={user.id}
                              existing={myFeedbackByPipeline[p.id]}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Feedback timeline (all interviewers' feedback) */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2 text-slate-200">
                <MessageSquare size={16} className="text-indigo-300" /><span className="font-medium">All feedback</span>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={Sparkles}
                onClick={() => summarize.mutate()}
                loading={summarize.isPending}
              >
                {brief ? 'Re-summarize' : 'AI summary'}
              </Button>
            </div>
            {brief && <CommitteeBrief brief={brief} />}
            <FeedbackTimeline candidateId={candidateId} pipelineRows={pipeline || []} />
          </Card>

          {/* Comments */}
          <Card>
            <div className="text-slate-200 font-medium mb-3">Comments</div>
            <CommentThread entityType="candidate" entityId={candidateId} />
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <Card>
            <div className="text-slate-200 font-medium mb-3">Profile</div>
            <div className="space-y-2 text-sm">
              {candidate.email && (
                <a href={`mailto:${candidate.email}`} className="flex items-center gap-2 text-slate-300 hover:text-indigo-300 break-all">
                  <Mail size={13} /> {candidate.email}
                </a>
              )}
              {candidate.phone && (
                <div className="flex items-center gap-2 text-slate-300">
                  <Phone size={13} /> {candidate.phone}
                </div>
              )}
              {candidate.linkedin_url && (
                <a href={candidate.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-slate-300 hover:text-indigo-300 break-all">
                  <Linkedin size={13} /> {candidate.linkedin_url}
                </a>
              )}
              <div className="text-xs text-slate-500 pt-2">
                Source: <span className="capitalize">{candidate.source}</span> · Added {new Date(candidate.created_at).toLocaleDateString()}
              </div>
            </div>
          </Card>

          {(siblings?.length || 0) > 0 && (
            <Card>
              <div className="flex items-center gap-2 text-slate-200 mb-3">
                <Copy size={16} className="text-indigo-300" />
                <span className="font-medium">Also considered as</span>
              </div>
              <div className="space-y-1.5">
                {siblings.map((s) => (
                  <Link
                    key={s.id}
                    to={`/candidates/${s.id}`}
                    className="block px-2 -mx-2 py-1.5 rounded-md hover:bg-slate-900/40"
                  >
                    <div className="text-sm text-slate-100">{s.role?.title}</div>
                    <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                      <span>{s.role?.project?.name}</span>
                      <span>·</span>
                      <StageBadge stageKey={s.current_stage_key} state="in_progress" size="sm" />
                      {s.status !== 'active' && <span className="capitalize text-rose-300">{s.status}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </Card>
          )}

          {candidate.resume_text && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-slate-200">
                  <FileText size={16} className="text-indigo-300" /><span className="font-medium">Resume</span>
                </div>
                <span className="text-[11px] text-slate-500">parsed</span>
              </div>
              <ResumeView text={candidate.resume_text} />
            </Card>
          )}
        </div>
      </div>

      <ConsiderForRoleDialog
        open={considerOpen}
        onClose={() => setConsiderOpen(false)}
        candidate={candidate}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete candidate?"
        message={
          <>
            <p>This permanently removes <strong className="text-slate-100">{candidate.full_name || 'this candidate'}</strong>, all their pipeline rows, feedback, comments, and the resume file in storage.</p>
            <p className="mt-2 text-rose-300 text-xs">This cannot be undone.</p>
          </>
        }
      />
    </>
  );
}

function AIEvaluation({ ai }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold text-slate-100">{ai.overallScore ?? '—'}</span>
          <span className="text-xs text-slate-500">/ 100 overall</span>
        </div>
        <RecommendationBadge value={ai.recommendation} />
        {typeof ai.jdMatchScore === 'number' && (
          <span className="text-[11px] text-slate-400">JD match: <strong className="text-slate-200">{ai.jdMatchScore}</strong></span>
        )}
      </div>
      {ai.summary && <p className="text-sm text-slate-300">{ai.summary}</p>}
      {ai.detailedAnalysis && (
        <div className="text-sm text-slate-300 leading-relaxed bg-slate-950/40 border border-slate-800 rounded-lg p-3">
          {ai.detailedAnalysis}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.isArray(ai.selectionReasons) && ai.selectionReasons.length > 0 && (
          <Section title="Why hire" tone="emerald" items={ai.selectionReasons} />
        )}
        {Array.isArray(ai.rejectionReasons) && ai.rejectionReasons.length > 0 && (
          <Section title="Why not" tone="rose" items={ai.rejectionReasons} />
        )}
        {Array.isArray(ai.strengths) && ai.strengths.length > 0 && (
          <Section title="Strengths" tone="emerald" items={ai.strengths} />
        )}
        {Array.isArray(ai.weaknesses) && ai.weaknesses.length > 0 && (
          <Section title="Weaknesses" tone="rose" items={ai.weaknesses} />
        )}
      </div>
      {ai.extractedInfo && (
        <div className="text-[11px] text-slate-500 pt-2 border-t border-slate-800">
          Extracted: {ai.extractedInfo.experience} yrs · {ai.extractedInfo.education} · {ai.extractedInfo.location || '—'}
          {Array.isArray(ai.extractedInfo.keySkills) && ai.extractedInfo.keySkills.length > 0 && (
            <> · {ai.extractedInfo.keySkills.slice(0, 8).join(', ')}</>
          )}
        </div>
      )}
    </div>
  );
}

function CommitteeBrief({ brief }) {
  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-3 mb-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Sparkles size={13} className="text-violet-300" />
        <span className="text-xs uppercase tracking-wide text-violet-300 font-medium">Committee brief</span>
        <RecommendationBadge value={brief.consensus} />
      </div>
      {brief.headline && <div className="text-sm text-slate-100 font-medium">{brief.headline}</div>}
      {brief.recommendation && <div className="text-sm text-slate-300 mt-1">{brief.recommendation}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2 text-xs">
        {Array.isArray(brief.strengths) && brief.strengths.length > 0 && (
          <div>
            <div className="text-emerald-300 font-medium mb-0.5">Strengths</div>
            <ul className="text-slate-300 list-disc list-inside space-y-0.5">{brief.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {Array.isArray(brief.concerns) && brief.concerns.length > 0 && (
          <div>
            <div className="text-rose-300 font-medium mb-0.5">Concerns</div>
            <ul className="text-slate-300 list-disc list-inside space-y-0.5">{brief.concerns.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
      </div>
      {brief.divergence && (
        <div className="mt-2 text-xs text-slate-400 italic">Divergence: {brief.divergence}</div>
      )}
    </div>
  );
}

function Section({ title, items, tone = 'slate' }) {
  const toneCls = tone === 'emerald'
    ? 'border-emerald-500/20 bg-emerald-500/5'
    : tone === 'rose'
    ? 'border-rose-500/20 bg-rose-500/5'
    : 'border-slate-800 bg-slate-900/40';
  return (
    <div className={`rounded-lg border ${toneCls} p-2.5`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-400 font-medium mb-1">{title}</div>
      <ul className="text-xs text-slate-300 list-disc list-inside space-y-0.5">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
