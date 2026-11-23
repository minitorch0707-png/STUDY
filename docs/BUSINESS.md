# Business plan

## The model: a free download plus a $5 Pro key

- **Everything runs on the student's computer**: the app, the AI engine and the AI model. That means **no server costs at all**, no matter how many people use it.
- The app is **free to download** from GitHub, with a useful free plan (2 courses).
- **LectureLab Pro** (unlimited courses, AI marking, exam simulations, planner) is unlocked with a **licence key** sold through Lemon Squeezy or Gumroad. The store takes payment, emails the key and handles tax and refunds. The app checks the key directly with the store. Setup guide: [SELLING.md](SELLING.md).
- Your job is to **keep adding features**. New versions are published with one click ([RELEASING.md](RELEASING.md)) and installed apps update themselves.

### The numbers

| | |
|---|---|
| Price | $5 one-time (easy impulse buy for students) |
| Store fee | ~$0.75 (Lemon Squeezy) or ~$1.00 (Gumroad) per sale |
| Your cost per user | $0, since nothing is hosted |
| Optional yearly costs | $99 Apple Developer (removes the Mac warning), ~$120 Windows signing |
| Break-even on signing costs | ~50 sales a year |

Ideas to grow revenue later, without servers: a **"Pro+ semester pass"** for bigger features (e.g. voice tutor, AI training on your own notes), **course packs** made by top students, and **campus ambassador codes** (Lemon Squeezy supports discount codes and affiliates).

## Promotion: TikTok and short videos

The app is visual, so short videos sell it well. They link to the GitHub page (or a simple landing page) in your bio.

**Video ideas that work for study apps:**

1. *"POV: you turned 80 lecture slides into a practice exam in 2 minutes."* A screen recording: upload, then exam, then score.
2. *"Your AI tutor cites the exact slide."* Click a citation chip and the original slide pops up.
3. *"Studying for finals with no ChatGPT subscription."* Everything runs free on your laptop.
4. *"I wouldn't have passed criminal law without this flashcard trick"* (spaced repetition explained in 20 seconds).
5. A before/after of a cramming week using the study planner.

**About the voices:** most of the voiceovers you hear on TikTok come from **TikTok's own built-in text-to-speech** (add text, then tap "Text-to-speech" and pick a voice), from **CapCut's** voice options, or from **ElevenLabs** (more realistic and paid, with a small free tier). For a free option on your own computer, open-source voices like **Piper** or **Kokoro** work well.

**What can be automated later:** LectureLab can already be driven by a script that records the screen (that's how the screenshots in this repo were made). A later step could turn a script into finished vertical videos: screen recording + captions + voiceover + music, assembled with `ffmpeg`. Voiceovers would come from a TTS service of your choice.

## Things to check before selling

- **Choose a code licence** (below). Without one, the code is "all rights reserved".
- **Terms and privacy page:** the store provides checkout terms. Add a short privacy note on the download page (the app keeps everything local, which is a strong selling point).
- **Course material copyright:** students study their own professors' slides privately on their own computers, which is the safest possible setup. Don't build features that share uploaded slides between users.
- **Model licences:** Qwen3 and nomic-embed-text are Apache 2.0 (commercial use OK). Ollama is MIT. Gemma 3 (optional vision model) has its own terms, which allow commercial use with a prohibited-use policy.
- **Academic integrity:** market it as a study tool (practice, explanations, revision), not as an assignment writer.

## Open decision: the code licence

The repo is public but has **no licence yet**:

- **AGPL-3.0** (recommended if you want contributors): anyone can use and improve it, but anyone who redistributes a modified version must also publish their code, which discourages clone-and-sell competitors.
- **MIT:** maximum adoption, but anyone can sell a copy.
- **Source-available** (e.g. PolyForm Noncommercial): people can read and contribute, but can't sell it. This protects the $5 product best.
- **No licence / private repo:** full control, but it's legally awkward for outside contributors.
