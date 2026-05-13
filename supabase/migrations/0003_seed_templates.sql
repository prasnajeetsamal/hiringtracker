-- 0003_seed_templates.sql
-- Seed system JD templates. Idempotent: re-running upserts on (name, is_system).

insert into public.jd_templates (name, category, is_system, body_html)
values
(
  'Senior Software Engineer',
  'engineering',
  true,
  $$<p>We're hiring a Senior Software Engineer to build and operate the systems behind our core product. You'll own substantial pieces of our backend, work closely with product and design, and help raise the engineering bar across the team.</p>
<p>In this role you will design, build, and ship customer-facing features end-to-end - from architecture sketches through code review, deployment, and on-call. You'll partner with product managers to scope work, break down ambiguous problems into shippable increments, and write code that is correct, observable, and pleasant for the next engineer to read. You will mentor mid-level engineers, run technical interviews, and contribute to architecture reviews.</p>
<p>We expect you to have 5+ years of professional software engineering experience, with at least 3 years working on production systems at meaningful scale. You should be fluent in at least one general-purpose backend language (Go, Python, TypeScript, Java, or similar), comfortable with relational databases and SQL, and experienced operating services in production - meaning you've been paged, you've debugged a real outage, and you've made a service better afterwards. Familiarity with cloud platforms (AWS, GCP, or Azure) and infrastructure-as-code is expected.</p>
<p>Bonus points for experience with distributed systems, event-driven architectures, performance optimization, or technical leadership of small teams. We particularly value engineers who can write clearly - design docs, postmortems, and code comments are first-class artifacts here.</p>
<p>You should be excited to work in a team where decisions are made through written proposals, code review is a craft, and shipping reliably is more celebrated than shipping fast.</p>
<p><strong>What we offer:</strong> competitive compensation including equity, health benefits, a remote-friendly schedule with quarterly in-person offsites, and a generous learning budget.</p>$$
),
(
  'Product Manager',
  'product',
  true,
  $$<p>We're hiring a Product Manager to own a core area of our product and partner with engineering and design to ship things customers love. You'll be the person who knows the most about your area's users, the problems they face, the metrics that matter, and the roadmap that gets us there.</p>
<p>Day to day you will talk to customers, synthesize their pain into clear problem statements, write crisp product specs, prioritize ruthlessly, and work with engineers and designers to ship and iterate. You will define success metrics before launch and follow up after launch to learn whether the metrics moved. You will represent your area in roadmap and strategy discussions and be accountable for the outcomes.</p>
<p>We expect you to have 3+ years of product management experience shipping software products, ideally B2B SaaS. You should be comfortable with quantitative analysis (you can pull your own SQL or get fluent quickly), have strong written communication, and bring a clear point of view about what makes a product great. You should be able to disagree productively with engineering and design partners and bring teams to consensus without authority.</p>
<p>We care less about pedigree and more about evidence: products you shipped, decisions you made and would defend, and lessons you learned the hard way. Tell us about a product bet that didn't work and what you took from it.</p>
<p>You will report to the Head of Product and work alongside a senior engineer and a designer who together form your pod.</p>
<p><strong>What we offer:</strong> competitive comp + equity, full benefits, hybrid work, and a real seat at the strategy table from week one.</p>$$
),
(
  'Senior Data Scientist',
  'data',
  true,
  $$<p>We're hiring a Senior Data Scientist to embed with product and engineering teams and turn data into decisions that change the trajectory of the business. This is a generalist role: you'll do experimentation, build models, do deep dives, and influence what we build next.</p>
<p>You will design and analyze A/B tests, build predictive models that ship in product (recommendation, ranking, scoring, churn), produce deep-dive analyses that change our roadmap, and help build the data foundations - definitions, dashboards, and self-serve tools - the rest of the company uses to make decisions. You will partner closely with PMs and engineers and be measured by the impact of the decisions your work drove, not the volume of analyses produced.</p>
<p>We expect you to have 4+ years in a data science, applied research, or quantitative analyst role, strong fundamentals in statistics and experimental design, and fluency in Python and SQL. Experience taking models to production - not just notebooks - is important. You should be comfortable working with messy data, framing ambiguous business questions, and presenting results to non-technical stakeholders.</p>
<p>Bonus: experience with causal inference, sequential testing, recommendation systems, or building shared ML infrastructure. We don't expect any one person to have all of these, but we'd love to know what you bring.</p>
<p>We believe data scientists do their best work when embedded in product teams rather than queued up behind a request board. You'll have an engineering pod and a PM partner from day one.</p>
<p><strong>What we offer:</strong> competitive comp + equity, full benefits, a flexible work setup, dedicated learning budget, and time carved out for deeper research projects.</p>$$
)
on conflict do nothing;
