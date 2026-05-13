import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ArrowRight, X, SkipForward, Sparkles, Linkedin, Mail, Phone,
  FileText, Wand2, MessageSquare, Trash2, Copy, ChevronDown, ChevronUp, AlertCircle,
  Check, CircleDot, Circle, ChevronRight, FileCode, Link2,
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
import EmailCandidateDialog from '../components/candidates/EmailCandidateDialog.jsx';
import ResumeView from '../components/candidates/ResumeView.jsx';
import TagsEditor from '../components/candidates/TagsEditor.jsx';
import FeedbackForm from '../components/feedback/FeedbackForm.jsx';
import FeedbackTimeline from '../components/feedback/FeedbackTimeline.jsx';
import CommentThread from '../components/comments/CommentThread.jsx';

import { supabase } from '../lib/supabase.js';
import { useAuth } from '../lib/AuthContext.jsx';
import { useIsAdmin } from '../lib/useIsAdmin.js';
import { scoreCandidate, summarizeFeedback, deleteCandidate, transitionCandidate } from '../lib/api.js';
import { STAGE_BY_KEY } from '../lib/pipeline.js';
import { renderHtmlDocument, downloadHtmlFile, esc, sanitizeHtml } from '../lib/htmlExport.js';

export default function CandidateDetailPage() {
  const { candidateId } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [considerOpen, setConsiderOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  // Collapse the AI evaluation by default if it's been scored - saves space.
  const [aiOpen, setAiOpen] = useState(false);

  const { data: candidate, isLoading } = useQuery({
    queryKey: ['candidate', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select(`
          id, full_name, email, phone, linkedin_url, resume_text, resume_file_id,
          source, current_stage_key, status, ai_score, ai_analysis, role_id, created_at, tags,
          public_token,
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

  // Determine "my pipeline rows" - rows where I'm assigned as interviewer
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
        .select('id, pipeline_id, recommendation, rating, body_html, submitted_at')
        .eq('interviewer_id', user.id)
        .in('pipeline_id', pipelineIds);
      if (error) throw error;
      return data;
    },
  });
  const myFeedbackByPipeline = Object.fromEntries((myFeedback || []).map((f) => [f.pipeline_id, f]));

  // All three transitions go through one server endpoint so the multi-row
  // update is atomic - a partial failure can't leave the pipeline half-flipped.
  const onTransitionSuccess = (label) => () => {
    toast.success(label);
    qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
    qc.invalidateQueries({ queryKey: ['candidate-pipeline', candidateId] });
    qc.invalidateQueries({ queryKey: ['candidates', candidate?.role_id] });
    qc.invalidateQueries({ queryKey: ['candidates-all'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };
  const advance = useMutation({
    mutationFn: async () => transitionCandidate({ candidateId, action: 'advance' }),
    onSuccess: onTransitionSuccess('Advanced'),
    onError: (e) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: async () => transitionCandidate({ candidateId, action: 'reject' }),
    onSuccess: onTransitionSuccess('Candidate rejected'),
    onError: (e) => toast.error(e.message),
  });
  const skip = useMutation({
    mutationFn: async () => transitionCandidate({ candidateId, action: 'skip' }),
    onSuccess: onTransitionSuccess('Stage skipped'),
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

  const updateTags = useMutation({
    mutationFn: async (tags) => {
      const { error } = await supabase
        .from('candidates')
        .update({ tags })
        .eq('id', candidateId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['candidate', candidateId] });
      qc.invalidateQueries({ queryKey: ['candidates-all'] });
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

  // Emails sent to this candidate (audit trail rendered as a sidebar card).
  // Filters by the candidateId we stamp into email_log.payload on send.
  const { data: candidateEmails } = useQuery({
    queryKey: ['candidate-emails', candidateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('email_log')
        .select('id, to_email, template, payload, status, created_at')
        .eq('payload->>candidateId', candidateId)
        .order('created_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
  });

  // Sibling candidates (same person on other roles) - match by email when set.
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

  // Banner: am I an interviewer assigned to the candidate's CURRENT stage, with no feedback?
  const currentPipelineRow = (pipeline || []).find((p) => p.stage_key === candidate.current_stage_key);
  const myFeedbackOnCurrent = currentPipelineRow ? myFeedbackByPipeline[currentPipelineRow.id] : null;
  const myPendingOnCurrent =
    currentPipelineRow && myAssignedPipelines.has(currentPipelineRow.id) && !myFeedbackOnCurrent;

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
            <Button variant="ghost" icon={Mail} onClick={() => setEmailOpen(true)} disabled={!candidate.email}>Email candidate</Button>
            <Button variant="ghost" icon={FileCode} onClick={() => exportCandidateHtml({ candidate, pipeline })}>HTML report</Button>
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

      {/* Pending-feedback banner */}
      {myPendingOnCurrent && currentPipelineRow && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 mb-4 flex items-center gap-3">
          <AlertCircle size={18} className="text-amber-300 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-slate-100 font-medium">
              Your feedback is pending on the {STAGE_BY_KEY[currentPipelineRow.stage_key]?.label || currentPipelineRow.stage_key} round.
            </div>
            <div className="text-xs text-slate-400">
              Scroll down to the {STAGE_BY_KEY[currentPipelineRow.stage_key]?.label || 'stage'} card to submit your recommendation.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 space-y-4">
          {/* AI evaluation - collapsible (collapsed by default once scored) */}
          <Card padding={false}>
            <div className="flex items-center justify-between px-5 py-3">
              <button
                type="button"
                onClick={() => ai && setAiOpen((v) => !v)}
                className="flex items-center gap-2 text-slate-200 flex-1 min-w-0 text-left"
                disabled={!ai}
              >
                <Sparkles size={16} className="text-indigo-300 shrink-0" />
                <span className="font-medium">AI evaluation</span>
                {ai && (
                  <>
                    <span className="text-2xl font-bold text-slate-100 ml-2 tabular-nums">{ai.overallScore ?? '-'}</span>
                    <span className="text-[10px] text-slate-500 mt-0.5">/100</span>
                    <RecommendationBadge value={ai.recommendation} />
                    <ChevronDown
                      size={14}
                      className={`text-slate-500 ml-auto transition ${aiOpen ? 'rotate-180' : ''}`}
                    />
                  </>
                )}
              </button>
              <Button
                size="sm"
                variant="secondary"
                icon={Wand2}
                onClick={() => score.mutate()}
                loading={score.isPending}
                disabled={!candidate.resume_text}
                title={!candidate.resume_text ? 'AI scoring needs an uploaded resume' : 'Score this candidate against the JD'}
                className="ml-2"
              >
                {ai ? 'Re-score' : 'Score against JD'}
              </Button>
            </div>
            {!candidate.resume_text ? (
              <div className="px-5 pb-4 text-sm text-slate-400">
                AI scoring is unavailable for LinkedIn-only candidates. Upload a resume to enable it.
              </div>
            ) : !ai ? (
              <div className="px-5 pb-4 text-sm text-slate-400">
                Click <strong>Score against JD</strong> to have Claude evaluate the resume against this role's JD.
              </div>
            ) : aiOpen ? (
              <div className="px-5 pb-5 border-t border-slate-800/60 pt-4">
                <AIEvaluation ai={ai} />
              </div>
            ) : (
              <div className="px-5 pb-3 text-xs text-slate-400 italic line-clamp-2">
                {ai.summary || 'Click to expand the full evaluation.'}
              </div>
            )}
          </Card>

          {/* Pipeline timeline - current stage expanded, others collapsed */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <div className="text-slate-200 font-medium">Pipeline</div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><CircleDot size={10} className="text-indigo-300" />current</span>
                <span className="inline-flex items-center gap-1"><Check size={10} className="text-emerald-300" />done</span>
                <span className="inline-flex items-center gap-1"><Circle size={10} />upcoming</span>
              </div>
            </div>
            <div className="space-y-2">
              {(pipeline || []).map((p) => (
                <PipelineStageRow
                  key={p.id}
                  row={p}
                  candidate={candidate}
                  isTerminal={isTerminal}
                  user={user}
                  myAssignedPipelines={myAssignedPipelines}
                  myFeedbackByPipeline={myFeedbackByPipeline}
                  skip={skip}
                  reject={reject}
                  advance={advance}
                />
              ))}
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
        <div className="space-y-4 min-w-0">
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

          {candidate.public_token && (
            <Card>
              <div className="flex items-center gap-2 text-slate-200 mb-2">
                <Link2 size={14} className="text-indigo-300" />
                <span className="font-medium text-sm">Candidate status link</span>
              </div>
              <div className="text-[11px] text-slate-500 mb-2 leading-relaxed">
                Share this link with the candidate so they can self-check their pipeline status. No Slate login required.
              </div>
              <div className="flex gap-1.5">
                <input
                  readOnly
                  value={`${window.location.origin}/c/${candidate.public_token}`}
                  onFocus={(e) => e.target.select()}
                  className="flex-1 min-w-0 bg-slate-950/60 border border-slate-700 rounded-md px-2 py-1.5 text-[11px] text-slate-100 font-mono"
                />
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/c/${candidate.public_token}`;
                    navigator.clipboard.writeText(url).then(
                      () => toast.success('Status link copied'),
                      () => toast.error('Copy failed'),
                    );
                  }}
                  className="text-[11px] px-2.5 py-1.5 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700 inline-flex items-center gap-1 shrink-0"
                  title="Copy status link"
                >
                  <Copy size={11} /> Copy
                </button>
              </div>
            </Card>
          )}

          <Card>
            <div className="text-slate-200 font-medium mb-2 text-sm">Tags</div>
            <TagsEditor
              value={candidate.tags || []}
              onChange={(next) => updateTags.mutate(next)}
              suggestions={['internal-referral', 'priority', 'diversity', 'must-hire', 'reachout', 'callback']}
            />
          </Card>

          {(candidateEmails?.length || 0) > 0 && (
            <Card>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-slate-200">
                  <Mail size={16} className="text-indigo-300" />
                  <span className="font-medium text-sm">Emails sent</span>
                </div>
                {candidate.email && (
                  <button
                    onClick={() => setEmailOpen(true)}
                    className="text-[11px] text-indigo-300 hover:text-indigo-200"
                  >
                    Compose →
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                {candidateEmails.map((e) => {
                  const tpl = (e.template || '').replace(/^candidate_/, '').replace(/_/g, ' ');
                  const failed = String(e.status || '').startsWith('error') || String(e.status || '').startsWith('exception');
                  const skipped = e.status === 'skipped_no_key';
                  return (
                    <div key={e.id} className="flex items-start gap-2 -mx-2 px-2 py-1 rounded-md hover:bg-slate-900/40">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-200 truncate capitalize">{tpl}</div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {e.payload?.subject || e.to_email}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-0.5 shrink-0">
                        <span className="text-[10px] text-slate-500 tabular-nums">{new Date(e.created_at).toLocaleDateString()}</span>
                        {failed && <span className="text-[10px] text-rose-300">failed</span>}
                        {skipped && <span className="text-[10px] text-amber-300">no-key</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

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

      <EmailCandidateDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
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

function PipelineStageRow({
  row, candidate, isTerminal, user, myAssignedPipelines, myFeedbackByPipeline,
  skip, reject, advance,
}) {
  const stage = STAGE_BY_KEY[row.stage_key];
  const isCurrent = row.stage_key === candidate.current_stage_key && !isTerminal;
  const stageEnabledCfg = candidate.role?.stage_config?.find((c) => c.stage_key === row.stage_key);
  // Current stage: expanded by default. The user can collapse explicitly.
  const [open, setOpen] = useState(isCurrent);
  // Re-sync when the active stage changes (e.g. after advance/skip).
  useEffect(() => { setOpen(isCurrent); }, [isCurrent]);

  const stateIcon = (() => {
    if (row.state === 'passed')   return <Check size={13} className="text-emerald-300" />;
    if (row.state === 'failed')   return <X size={13} className="text-rose-300" />;
    if (row.state === 'skipped')  return <SkipForward size={13} className="text-slate-400" />;
    if (row.state === 'in_progress') return <CircleDot size={13} className="text-indigo-300" />;
    return <Circle size={13} className="text-slate-600" />;
  })();

  const dateLabel = row.completed_at
    ? `Completed ${new Date(row.completed_at).toLocaleDateString()}`
    : row.started_at
    ? `Started ${new Date(row.started_at).toLocaleDateString()}`
    : '';

  const canExpand = row.state !== 'skipped';

  return (
    <div
      className={`rounded-lg border transition ${
        isCurrent
          ? 'border-indigo-500/50 bg-indigo-500/5 ring-1 ring-indigo-500/20'
          : 'border-slate-800 bg-slate-900/40'
      }`}
    >
      {/* Header row - always visible. Click anywhere (except actions) to expand/collapse. */}
      <button
        type="button"
        onClick={() => canExpand && setOpen((v) => !v)}
        disabled={!canExpand}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <span className="shrink-0">{stateIcon}</span>
        <span className={`text-sm font-medium ${isCurrent ? 'text-slate-50' : 'text-slate-200'}`}>
          {stage?.label || row.stage_key}
        </span>
        {isCurrent && (
          <span className="text-[10px] uppercase tracking-wide text-indigo-300 bg-indigo-500/15 border border-indigo-500/30 rounded-full px-1.5 py-0.5">
            current
          </span>
        )}
        <StageBadge stageKey={row.stage_key} state={row.state} size="sm" />
        <span className="text-[11px] text-slate-500 ml-auto">{dateLabel}</span>
        {canExpand && (
          <ChevronRight
            size={14}
            className={`text-slate-500 transition-transform shrink-0 ${open ? 'rotate-90' : ''}`}
          />
        )}
      </button>

      {open && canExpand && (
        <div className="px-3 pb-3 border-t border-slate-800/60">
          {stageEnabledCfg?.what_to_expect && (
            <div className="text-xs text-slate-400 pt-2.5">{stageEnabledCfg.what_to_expect}</div>
          )}

          {/* Quick actions for the current stage */}
          {isCurrent && (
            <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
              <button
                onClick={() => skip.mutate()}
                disabled={skip.isPending}
                className="text-[11px] px-2 py-1 rounded-md text-slate-300 hover:text-slate-100 hover:bg-slate-800/60 border border-slate-700"
              >
                Skip
              </button>
              <button
                onClick={() => reject.mutate()}
                disabled={reject.isPending}
                className="text-[11px] px-2 py-1 rounded-md text-rose-300 hover:text-rose-200 hover:bg-rose-500/10 border border-rose-500/30"
              >
                Reject
              </button>
              <button
                onClick={() => advance.mutate()}
                disabled={advance.isPending}
                className="text-[11px] px-2 py-1 rounded-md text-emerald-200 hover:text-emerald-100 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 inline-flex items-center gap-1"
              >
                Advance <ArrowRight size={10} />
              </button>
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-slate-800/60">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1.5">Interviewers</div>
            <InterviewerAssignment pipelineId={row.id} />
            {myAssignedPipelines.has(row.id) && (
              <FeedbackSection
                pipelineId={row.id}
                interviewerId={user.id}
                existing={myFeedbackByPipeline[row.id]}
              />
            )}
          </div>

          {/* Per-stage discussion thread (separate from the candidate-level Comments card) */}
          <div className="mt-3 pt-3 border-t border-slate-800/60">
            <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-2 flex items-center gap-1.5">
              <MessageSquare size={11} /> Stage discussion
            </div>
            <CommentThread entityType="pipeline" entityId={row.id} compact />
          </div>
        </div>
      )}
    </div>
  );
}

const RECOMMENDATION_LABEL = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  no_hire: 'No Hire',
  strong_no_hire: 'Strong No Hire',
};
const RECOMMENDATION_TONE = {
  strong_hire: 'text-emerald-200',
  hire: 'text-emerald-300',
  no_hire: 'text-rose-300',
  strong_no_hire: 'text-rose-200',
};

function FeedbackSection({ pipelineId, interviewerId, existing }) {
  // Default: closed if feedback already exists (just show summary); open if not (work to do).
  const [open, setOpen] = useState(!existing);
  // Re-sync when an existing record materialises (e.g. submission completes).
  useEffect(() => { setOpen(!existing); }, [existing?.id]);

  const submittedLabel = existing?.submitted_at
    ? new Date(existing.submitted_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null;
  const recLabel = existing ? RECOMMENDATION_LABEL[existing.recommendation] || existing.recommendation : null;
  const recTone = existing ? RECOMMENDATION_TONE[existing.recommendation] || 'text-slate-200' : 'text-slate-200';

  return (
    <div className="mt-3 pt-3 border-t border-slate-800/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 text-left"
      >
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Your feedback</span>
        {existing ? (
          <span className="flex items-center gap-1.5 text-xs ml-1">
            <Check size={11} className="text-emerald-300" />
            <span className={recTone + ' font-medium'}>{recLabel}</span>
            {typeof existing.rating === 'number' && existing.rating > 0 && (
              <span className="text-slate-500">- {existing.rating}/5</span>
            )}
            {submittedLabel && <span className="text-slate-500">- {submittedLabel}</span>}
          </span>
        ) : (
          <span className="text-xs text-amber-300 ml-1">Pending</span>
        )}
        <ChevronRight
          size={13}
          className={`text-slate-500 ml-auto transition-transform ${open ? 'rotate-90' : ''}`}
        />
      </button>
      {open && (
        <div className="mt-2.5">
          <FeedbackForm
            pipelineId={pipelineId}
            interviewerId={interviewerId}
            existing={existing}
          />
        </div>
      )}
    </div>
  );
}

function AIEvaluation({ ai }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-3xl font-bold text-slate-100">{ai.overallScore ?? '-'}</span>
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
          Extracted: {ai.extractedInfo.experience} yrs · {ai.extractedInfo.education} · {ai.extractedInfo.location || '-'}
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

// ─── HTML export ─────────────────────────────────────────────────────────
// Builds a self-contained "candidate brief" file for sharing outside Slate.
// Fetches all feedback rows on click so the export captures the full record.

async function exportCandidateHtml({ candidate, pipeline }) {
  if (!candidate) return;
  try {
    const pipelineIds = (pipeline || []).map((p) => p.id);
    let feedback = [];
    if (pipelineIds.length) {
      const { data } = await supabase
        .from('feedback')
        .select(`
          id, pipeline_id, recommendation, rating, body_html, submitted_at,
          interviewer:profiles!feedback_interviewer_id_fkey ( id, full_name, email )
        `)
        .in('pipeline_id', pipelineIds)
        .order('submitted_at', { ascending: true });
      feedback = data || [];
    }

    const html = renderHtmlDocument({
      title: `Slate - ${candidate.full_name || 'Candidate'}`,
      header: {
        eyebrow: 'Slate · Candidate brief',
        title: candidate.full_name || 'Unnamed candidate',
        subtitle: [
          candidate.role?.title,
          candidate.role?.project?.name,
          `Status: ${candidate.status}`,
        ].filter(Boolean).join(' · '),
      },
      body: buildCandidateHtmlBody(candidate, pipeline || [], feedback),
    });
    downloadHtmlFile(html, `slate-candidate-${(candidate.full_name || 'unnamed').toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.html`);
    toast.success('Candidate report downloaded');
  } catch (e) {
    toast.error(e.message || 'Failed to build report');
  }
}

const REC_LABEL = {
  strong_hire: 'Strong Hire',
  hire: 'Hire',
  no_hire: 'No Hire',
  strong_no_hire: 'Strong No Hire',
};
const REC_CLASS = {
  strong_hire: 'rec--hire',
  hire: 'rec--hire',
  no_hire: 'rec--reject',
  strong_no_hire: 'rec--reject',
};

function buildCandidateHtmlBody(candidate, pipeline, feedback) {
  const ai = candidate.ai_analysis || null;

  // Profile meta panel
  const meta = `
    <div class="panel">
      <div class="panel__title">Profile</div>
      <dl class="meta-grid">
        ${candidate.email ? `<dt>Email</dt><dd><a href="mailto:${esc(candidate.email)}">${esc(candidate.email)}</a></dd>` : ''}
        ${candidate.phone ? `<dt>Phone</dt><dd>${esc(candidate.phone)}</dd>` : ''}
        ${candidate.linkedin_url ? `<dt>LinkedIn</dt><dd><a href="${esc(candidate.linkedin_url)}">${esc(candidate.linkedin_url)}</a></dd>` : ''}
        <dt>Role</dt><dd>${esc(candidate.role?.title || '-')}</dd>
        <dt>Project</dt><dd>${esc(candidate.role?.project?.name || '-')}</dd>
        <dt>Current stage</dt><dd>${esc(STAGE_BY_KEY[candidate.current_stage_key]?.label || candidate.current_stage_key || '-')}</dd>
        <dt>Status</dt><dd>${esc(candidate.status)}</dd>
        <dt>Source</dt><dd>${esc(candidate.source || '-')}</dd>
        <dt>Added</dt><dd>${esc(new Date(candidate.created_at).toLocaleDateString())}</dd>
        ${(candidate.tags || []).length ? `<dt>Tags</dt><dd>${(candidate.tags || []).map((t) => `<span class="pill pill--indigo">${esc(t)}</span>`).join(' ')}</dd>` : ''}
        ${typeof candidate.ai_score === 'number' ? `<dt>AI score</dt><dd><strong>${candidate.ai_score}</strong> / 100${ai?.recommendation ? ` · ${esc(ai.recommendation)}` : ''}</dd>` : ''}
      </dl>
    </div>`;

  // AI evaluation
  const aiBlock = !ai ? '' : `
    <div class="panel">
      <div class="panel__title">AI evaluation</div>
      ${ai.summary ? `<p>${esc(ai.summary)}</p>` : ''}
      ${ai.detailedAnalysis ? `<p>${esc(ai.detailedAnalysis)}</p>` : ''}
      <div class="grid-2">
        ${Array.isArray(ai.selectionReasons) && ai.selectionReasons.length ? `<div><h3>Why hire</h3><ul>${ai.selectionReasons.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${Array.isArray(ai.rejectionReasons) && ai.rejectionReasons.length ? `<div><h3>Why not</h3><ul>${ai.rejectionReasons.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${Array.isArray(ai.strengths) && ai.strengths.length ? `<div><h3>Strengths</h3><ul>${ai.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${Array.isArray(ai.weaknesses) && ai.weaknesses.length ? `<div><h3>Weaknesses</h3><ul>${ai.weaknesses.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      </div>
    </div>`;

  // Pipeline timeline
  const stateLabel = { in_progress: 'In progress', passed: 'Passed', failed: 'Rejected', skipped: 'Skipped', pending: 'Pending' };
  const stateClass = { in_progress: 'pill--indigo', passed: 'pill--emerald', failed: 'pill--rose', skipped: 'pill--violet', pending: '' };
  const pipelineRows = pipeline
    .slice()
    .sort((a, b) => (a.stage_order || 0) - (b.stage_order || 0))
    .map((p) => `
      <tr>
        <td>${esc(STAGE_BY_KEY[p.stage_key]?.label || p.stage_key)}</td>
        <td><span class="pill ${stateClass[p.state] || ''}">${esc(stateLabel[p.state] || p.state)}</span></td>
        <td class="num">${p.started_at ? esc(new Date(p.started_at).toLocaleDateString()) : '-'}</td>
        <td class="num">${p.completed_at ? esc(new Date(p.completed_at).toLocaleDateString()) : '-'}</td>
      </tr>`).join('');
  const pipelineBlock = `
    <div class="panel">
      <div class="panel__title">Pipeline timeline</div>
      <table>
        <thead>
          <tr><th>Stage</th><th>State</th><th class="num">Started</th><th class="num">Completed</th></tr>
        </thead>
        <tbody>${pipelineRows}</tbody>
      </table>
    </div>`;

  // Feedback grouped by stage
  const fbByPipeline = feedback.reduce((acc, f) => {
    (acc[f.pipeline_id] = acc[f.pipeline_id] || []).push(f);
    return acc;
  }, {});
  const stagesWithFeedback = pipeline.filter((p) => fbByPipeline[p.id]?.length);
  const fbBlock = stagesWithFeedback.length === 0 ? `
    <div class="panel">
      <div class="panel__title">Interviewer feedback</div>
      <div class="muted">No feedback submitted yet.</div>
    </div>` : `
    <div class="panel">
      <div class="panel__title">Interviewer feedback</div>
      ${stagesWithFeedback.map((p) => `
        <h2>${esc(STAGE_BY_KEY[p.stage_key]?.label || p.stage_key)}</h2>
        ${fbByPipeline[p.id].map((f) => `
          <div style="margin: 0.6em 0; padding-bottom: 0.6em; border-bottom: 1px solid rgba(148,163,184,0.12);">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <strong>${esc(f.interviewer?.full_name || f.interviewer?.email || 'Unknown')}</strong>
              ${f.recommendation ? `<span class="pill ${REC_CLASS[f.recommendation] || ''}">${esc(REC_LABEL[f.recommendation] || f.recommendation)}</span>` : ''}
              ${typeof f.rating === 'number' && f.rating > 0 ? `<span class="pill pill--amber">${f.rating}/5</span>` : ''}
              <span class="generated" style="margin-left:auto;">${f.submitted_at ? esc(new Date(f.submitted_at).toLocaleDateString()) : ''}</span>
            </div>
            ${f.body_html ? `<div style="margin-top:0.4em;">${sanitizeHtml(f.body_html)}</div>` : ''}
          </div>`).join('')}
      `).join('')}
    </div>`;

  // Committee brief if AI synthesised one
  const brief = ai?.committee_brief;
  const briefBlock = !brief ? '' : `
    <div class="panel">
      <div class="panel__title">AI committee brief</div>
      ${brief.headline ? `<p><strong>${esc(brief.headline)}</strong></p>` : ''}
      ${brief.recommendation ? `<p>${esc(brief.recommendation)}</p>` : ''}
      <div class="grid-2">
        ${Array.isArray(brief.strengths) && brief.strengths.length ? `<div><h3>Strengths</h3><ul>${brief.strengths.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
        ${Array.isArray(brief.concerns) && brief.concerns.length ? `<div><h3>Concerns</h3><ul>${brief.concerns.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : ''}
      </div>
      ${brief.divergence ? `<p class="muted">Divergence: ${esc(brief.divergence)}</p>` : ''}
    </div>`;

  return [meta, aiBlock, pipelineBlock, fbBlock, briefBlock].filter(Boolean).join('\n');
}
