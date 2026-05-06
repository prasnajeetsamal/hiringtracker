-- supabase/demo/seed_demo_data.sql
-- ────────────────────────────────────────────────────────────────────
-- Idempotent demo-data seeder for Slate.
--
-- Adds candidates across every role in every project (skipping roles
-- that already have real candidates), with diverse pipeline stages,
-- statuses, AI scores, feedback, comments, and availability slots.
--
-- All seeded candidates are tagged with `tags @> ARRAY['demo']` so you
-- can find and bulk-delete them later:
--
--   delete from public.candidates where 'demo' = any(tags);
--
-- Re-running this script wipes any existing demo data first, then
-- re-seeds, so it's safe to run multiple times.
-- ────────────────────────────────────────────────────────────────────

-- ─── 0. Wipe any previous demo data ─────────────────────────────────
delete from public.candidates where 'demo' = any(tags);
delete from public.availability_slots
  where interviewer_id in (
    select owner_id from public.hiring_projects where owner_id is not null
  )
  and starts_at >= now() - interval '7 days'
  and starts_at <= now() + interval '30 days';

-- ─── helper: a fixed pool of demo people ─────────────────────────────
-- (name, email, phone, linkedin, source)
create temporary table _demo_people on commit drop as
select * from (values
  ('Aanya Verma',          'aanya.verma@example.com',          '+91 98100 12001', 'https://www.linkedin.com/in/aanyaverma',     'uploaded'),
  ('Rohan Mehta',          'rohan.mehta@example.com',          '+91 98100 12002', 'https://www.linkedin.com/in/rohanmehta',     'uploaded'),
  ('Saanvi Iyer',          'saanvi.iyer@example.com',          '+91 98100 12003', 'https://www.linkedin.com/in/saanviiyer',     'uploaded'),
  ('Aarav Sharma',         'aarav.sharma@example.com',         '+91 98100 12004', 'https://www.linkedin.com/in/aaravsharma',    'linkedin'),
  ('Diya Kapoor',          'diya.kapoor@example.com',          '+91 98100 12005', 'https://www.linkedin.com/in/diyakapoor',     'uploaded'),
  ('Vihaan Reddy',         'vihaan.reddy@example.com',         '+91 98100 12006', 'https://www.linkedin.com/in/vihaanreddy',    'referral'),
  ('Anika Joshi',          'anika.joshi@example.com',          '+91 98100 12007', 'https://www.linkedin.com/in/anikajoshi',     'uploaded'),
  ('Ishaan Pillai',        'ishaan.pillai@example.com',        '+91 98100 12008', 'https://www.linkedin.com/in/ishaanpillai',   'uploaded'),
  ('Riya Banerjee',        'riya.banerjee@example.com',        '+91 98100 12009', 'https://www.linkedin.com/in/riyabanerjee',   'linkedin'),
  ('Kabir Nair',           'kabir.nair@example.com',           '+91 98100 12010', 'https://www.linkedin.com/in/kabirnair',      'uploaded'),
  ('Myra Bhattacharya',    'myra.b@example.com',               '+91 98100 12011', 'https://www.linkedin.com/in/myrab',          'uploaded'),
  ('Arjun Krishnan',       'arjun.krishnan@example.com',       '+91 98100 12012', 'https://www.linkedin.com/in/arjunkrishnan',  'manual'),
  ('Tara Sundaram',        'tara.sundaram@example.com',        '+91 98100 12013', 'https://www.linkedin.com/in/tarasundaram',   'uploaded'),
  ('Reyansh Choudhury',    'reyansh.c@example.com',            '+91 98100 12014', 'https://www.linkedin.com/in/reyanshc',       'uploaded'),
  ('Pari Saxena',          'pari.saxena@example.com',          '+91 98100 12015', 'https://www.linkedin.com/in/parisaxena',     'linkedin'),
  ('Aryan Malhotra',       'aryan.malhotra@example.com',       '+91 98100 12016', 'https://www.linkedin.com/in/aryanmalhotra',  'uploaded'),
  ('Ananya Roy',           'ananya.roy@example.com',           '+91 98100 12017', 'https://www.linkedin.com/in/ananyaroy',      'referral'),
  ('Vivaan Desai',         'vivaan.desai@example.com',         '+91 98100 12018', 'https://www.linkedin.com/in/vivaandesai',    'uploaded'),
  ('Kiara Menon',          'kiara.menon@example.com',          '+91 98100 12019', 'https://www.linkedin.com/in/kiaramenon',     'uploaded'),
  ('Atharv Gupta',         'atharv.gupta@example.com',         '+91 98100 12020', 'https://www.linkedin.com/in/atharvgupta',    'uploaded'),
  ('Zara Pandey',          'zara.pandey@example.com',          '+91 98100 12021', 'https://www.linkedin.com/in/zarapandey',     'linkedin'),
  ('Dhruv Agrawal',        'dhruv.agrawal@example.com',        '+91 98100 12022', 'https://www.linkedin.com/in/dhruvagrawal',   'uploaded'),
  ('Nisha Sehgal',         'nisha.sehgal@example.com',         '+91 98100 12023', 'https://www.linkedin.com/in/nishasehgal',    'uploaded'),
  ('Yash Bhargava',        'yash.bhargava@example.com',        '+91 98100 12024', 'https://www.linkedin.com/in/yashbhargava',   'manual'),
  ('Tanvi Rao',            'tanvi.rao@example.com',            '+91 98100 12025', 'https://www.linkedin.com/in/tanvirao',       'uploaded'),
  ('Mihir Saha',           'mihir.saha@example.com',           '+91 98100 12026', 'https://www.linkedin.com/in/mihirsaha',      'uploaded'),
  ('Nitya Kulkarni',       'nitya.kulkarni@example.com',       '+91 98100 12027', 'https://www.linkedin.com/in/nityakulkarni',  'linkedin'),
  ('Aditya Bose',          'aditya.bose@example.com',          '+91 98100 12028', 'https://www.linkedin.com/in/adityabose',     'uploaded'),
  ('Aditi Khanna',         'aditi.khanna@example.com',         '+91 98100 12029', 'https://www.linkedin.com/in/aditikhanna',    'uploaded'),
  ('Rudra Tripathi',       'rudra.tripathi@example.com',       '+91 98100 12030', 'https://www.linkedin.com/in/rudratripathi',  'referral')
) as t (full_name, email, phone, linkedin_url, source);

-- ─── 1. Insert candidates across every role ─────────────────────────
-- Skip roles that already have real (non-demo) candidates so we don't
-- pollute existing pipelines you've been using.

with eligible_roles as (
  select r.id as role_id, r.title, r.project_id
  from public.roles r
  where not exists (
    select 1 from public.candidates c
    where c.role_id = r.id and not ('demo' = any(coalesce(c.tags, '{}')))
  )
),
people_with_index as (
  select row_number() over () as rn, *
  from _demo_people
),
role_seq as (
  select row_number() over (order by role_id) as ridx, role_id, title
  from eligible_roles
),
-- Distribute people across roles (5 candidates per role)
plan as (
  select
    rs.role_id,
    rs.title,
    p.full_name,
    p.email,
    p.phone,
    p.linkedin_url,
    p.source,
    -- Pseudo-random stage by hashing full_name + role_id
    (abs(hashtext(rs.role_id::text || p.full_name)) % 7) as stage_idx,
    -- Pseudo-random AI score (60-95 inclusive)
    60 + (abs(hashtext(p.full_name)) % 36) as fake_score,
    -- Pseudo-random status: mostly active, some rejected/hired
    case
      when abs(hashtext('status' || p.full_name || rs.role_id::text)) % 10 < 1 then 'rejected'
      when abs(hashtext('status' || p.full_name || rs.role_id::text)) % 50 < 1 then 'hired'
      else 'active'
    end as fake_status
  from role_seq rs
  cross join lateral (
    select * from people_with_index
    -- 5 candidates per role, rotated through the 30-person pool
    where rn between ((rs.ridx - 1) * 5) % 30 + 1 and (((rs.ridx - 1) * 5) % 30) + 5
  ) p
),
stages as (
  select * from (values
    (0, 'resume_submitted'),
    (1, 'hm_review'),
    (2, 'technical_written'),
    (3, 'technical_interview'),
    (4, 'problem_solving'),
    (5, 'case_study'),
    (6, 'offer')
  ) as t (idx, stage_key)
)
insert into public.candidates (
  role_id, full_name, email, phone, linkedin_url, source,
  current_stage_key, status, ai_score, ai_analysis, tags, resume_text
)
select
  pl.role_id,
  pl.full_name,
  pl.email,
  pl.phone,
  pl.linkedin_url,
  pl.source,
  s.stage_key,
  pl.fake_status,
  case when pl.source = 'linkedin' then null else pl.fake_score end,
  case when pl.source = 'linkedin' then null else
    jsonb_build_object(
      'overallScore', pl.fake_score,
      'jdMatchScore', pl.fake_score - 5,
      'recommendation', case
        when pl.fake_score >= 80 then 'HIRE'
        when pl.fake_score >= 65 then 'CONSIDER'
        else 'REJECT'
      end,
      'summary', 'Demo evaluation — synthetic data for visualization purposes.',
      'detailedAnalysis', 'This candidate is part of the demo seed and shows representative metrics across the rubric. In a real evaluation Claude would produce a 150-300 word analysis grounded in the resume and JD; this is a placeholder.',
      'strengths', jsonb_build_array('Demo strength 1', 'Demo strength 2', 'Demo strength 3'),
      'weaknesses', jsonb_build_array('Demo weakness 1', 'Demo weakness 2'),
      'extractedInfo', jsonb_build_object(
        'experience', 4 + (abs(hashtext(pl.full_name || 'exp')) % 10),
        'location', case (abs(hashtext(pl.full_name || 'loc')) % 4)
          when 0 then 'Bengaluru'
          when 1 then 'Mumbai'
          when 2 then 'Remote'
          else 'Pune' end,
        'education', case (abs(hashtext(pl.full_name || 'edu')) % 3)
          when 0 then 'bachelors'
          when 1 then 'masters'
          else 'bachelors' end,
        'keySkills', jsonb_build_array('Python', 'SQL', 'Communication')
      )
    )
  end,
  array['demo'],
  case when pl.source = 'linkedin' then null else
    'DEMO RESUME — ' || pl.full_name || E'\n\n' ||
    'Synthetic resume content for visualization purposes only. ' ||
    'In production this would be the parsed text of an uploaded PDF.'
  end
from plan pl
join stages s on s.idx = pl.stage_idx
on conflict do nothing;

-- ─── 2. Add a few comments on demo candidates ───────────────────────
insert into public.comments (entity_type, entity_id, author_id, body_html)
select
  'candidate',
  c.id,
  hp.owner_id,
  '<p>' || (array[
    'Strong written work in the take-home. Recommend advancing.',
    'Mixed signal on system-design depth — would want a second interviewer.',
    'Background fits perfectly. Schedule technical round next.',
    'Promising profile but the experience is light for this level.',
    'Excellent communication. Worth a panel conversation.'
  ])[1 + (abs(hashtext('comment' || c.id::text)) % 5)] || '</p>'
from public.candidates c
join public.roles r on r.id = c.role_id
join public.hiring_projects hp on hp.id = r.project_id
where 'demo' = any(c.tags)
  and c.current_stage_key in ('hm_review','technical_written','technical_interview','problem_solving','case_study')
  and (abs(hashtext(c.id::text)) % 3) = 0;  -- ~1 in 3 candidates gets a comment

-- ─── 3. Add availability slots for the project owner (you) ──────────
-- 6 weekday slots over the next two weeks, 1 hour each, mid-day.
insert into public.availability_slots (interviewer_id, starts_at, ends_at, status, recurrence)
select
  hp.owner_id,
  ((current_date + (i || ' days')::interval)::timestamptz + interval '10 hours' + (slot_offset || ' hours')::interval) at time zone 'UTC',
  ((current_date + (i || ' days')::interval)::timestamptz + interval '11 hours' + (slot_offset || ' hours')::interval) at time zone 'UTC',
  'open',
  'none'
from (select distinct owner_id from public.hiring_projects where owner_id is not null limit 1) hp
cross join generate_series(1, 14) i
cross join lateral (values (0), (3)) as t (slot_offset)
where extract(dow from current_date + (i || ' days')::interval) between 1 and 5  -- weekdays
on conflict do nothing;

-- ─── 4. Summary ─────────────────────────────────────────────────────
select 'demo candidates inserted' as label, count(*)::text as value
from public.candidates where 'demo' = any(tags)
union all
select 'demo comments inserted', count(*)::text
from public.comments c
where exists (
  select 1 from public.candidates ca
  where ca.id = c.entity_id and 'demo' = any(ca.tags)
)
union all
select 'availability slots inserted', count(*)::text
from public.availability_slots
where starts_at >= now() and starts_at <= now() + interval '21 days';
