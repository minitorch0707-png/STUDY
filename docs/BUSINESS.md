# Making money with LectureLab

A practical plan. In short: **keep the local app free, and charge for a hosted version that "just works" in the browser.** Then sell to universities once students love it.

## Why the local version alone is hard to sell

The local app costs you nothing to run, but it is also hard to charge for. Students must install it, it needs a decent laptop, it doesn't sync between devices, and anyone can copy free software. Its real value is as **marketing and a trust signal** ("private, open, works offline").

What students *will* pay for is convenience: open a website on any device, upload slides, and study, with no installs and no slow laptop.

## Recommended model: "open core"

| Tier | Who | Price idea | What they get |
|---|---|---|---|
| **Free, local** | Tech-savvy students | Free forever | Everything, on their own Mac |
| **Free, hosted** | Everyone (to try it) | Free | 1 course, a limited number of AI lessons/quizzes per month |
| **Student Pro, hosted** | Most paying users | ~$8–12/month, or a **semester pass ~$25–35** | Unlimited courses, bigger models, phone + laptop sync, exam-season priority |
| **Institution** | Departments, tutoring centres | Per student per term (e.g. $3–10) | Instructor dashboard, course packs, single sign-on, invoices |

Students think in semesters and exam seasons, so a **semester pass** usually converts better than a monthly subscription. Test both.

**Avoid:** ads (they undermine the privacy promise) and selling data (never).

## Rough costs per student (verify current prices before deciding)

- **AI:** a small open-weight model (4–8B parameters) is cheap to serve. A busy student might use a few hundred thousand tokens a month. On a rented GPU running vLLM, or through a hosted open-weight API, that typically costs **cents to tens of cents per student per month**. Check current per-token and GPU-hour prices; they change often.
- **Database and storage:** Supabase has a free tier, and the paid plan starts at a few tens of dollars a month for hundreds of students.
- **Biggest real cost:** your time, plus getting students to find the app (marketing), not servers.

So even ~$5/month per paying student leaves healthy margins. The challenge is **retention**: students must keep coming back all semester.

## What must be built before charging money

In order (each is in the [Roadmap](ROADMAP.md), Milestone 3):

1. **Accounts and data isolation**: Supabase Auth plus row-level security, so no student can ever access another's files.
2. **Hosted AI**: the app already supports any OpenAI-compatible server, so this is configuration, not a rewrite.
3. **Usage limits**: per-plan quotas on lessons, quizzes and uploads.
4. **Payments**: Stripe Checkout, the customer portal (students cancel themselves) and webhooks to turn plans on and off.
5. **Legal basics**: privacy policy, terms of service, a "delete my data" button, and (for EU or institutional customers) GDPR or FERPA review.

## Things to check (risks)

- **Course material copyright:** students upload their professors' slides. Keep each student's files private to them and don't share uploaded materials between users. Shared decks should contain only what students write themselves. Put this in the terms.
- **Academic integrity:** position LectureLab as a *study* tool (practice, explanation, revision), not an assignment writer. Universities will ask.
- **Model licences:** Qwen3 and nomic-embed-text use Apache 2.0, which allows commercial use. Gemma 3 has its own terms of use, which allow commercial use with a prohibited-use policy. Re-check the licence of any model before using it commercially.
- **YouTube API:** commercial apps may use it, but must follow YouTube's branding and display rules and the quota limits.

## How to validate before building payments (cheap and fast)

1. Get **20 students in your own program** using the free version through one exam season.
2. Measure: did they come back weekly? Did they upload a second course? Did their quiz scores improve?
3. Ask the ones who stayed: "Would you pay $25 for a semester?" Better still, put up a **"Pre-order the hosted version"** page and count real sign-ups.
4. Talk to one tutoring centre or study-skills office at your university. Institutions move slowly, but pay reliably.

If fewer than ~30% of trial students are still using it after a month, improve the product before building billing.

## Open decision: the code licence

The repo is public but has **no licence yet**. Legally that means "all rights reserved": people can read the code but not reuse it. Pick one before inviting contributors:

- **AGPL-3.0** (recommended if you want it open source): anyone can use and improve it, but a competitor who runs it as a website must publish their changes. This protects the hosted business. Many open-core companies use this.
- **MIT:** maximum adoption, and anyone, including competitors, can build a closed paid version.
- **Stay unlicensed, or make the repo private:** keeps full control, but outside contributions become legally awkward.
