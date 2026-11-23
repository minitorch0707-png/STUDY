# Selling LectureLab Pro (no server needed)

LectureLab is free to download. **LectureLab Pro** is unlocked with a licence key. The student buys a key from a store, pastes it into the app, and the app checks it **directly with the store**. You never run a server, and the store handles payments, receipts, refunds and sales tax.

Free vs Pro is set in [`src/lib/product.ts`](../src/lib/product.ts):

| Free | Pro |
|---|---|
| 2 courses with everything: AI tutor, practice quizzes, flashcards, progress | Unlimited courses |
| Written answers marked by you against the rubric | Written answers marked by the AI |
| | Timed exam simulations |
| | Study planner and Exam Cram |

## Option A (recommended): Lemon Squeezy

Lower fees than Gumroad (about 5% + 50¢ per sale). It's a "merchant of record", so it handles worldwide sales tax for you, and it enforces "one key = up to 3 computers" automatically.

1. Sign up at **lemonsqueezy.com** and finish the store setup (payout details).
2. **Products → New product**: name it "LectureLab Pro", price **$5**, type **single payment**.
3. In the product, turn on **"Generate license keys"**. Set **activation limit = 3** and **expires = never**.
4. Publish it and copy the **product link**. Students go there to buy.
5. Find your IDs: **Settings → Stores** (store ID), and the product's **⋯ → Copy ID** (product ID).
6. Edit `src/lib/product.ts`:

   ```ts
   licenseProvider: "lemonsqueezy",
   buyUrl: "https://YOURSTORE.lemonsqueezy.com/buy/xxxx",
   lemonSqueezy: { storeId: 12345, productId: 67890 },
   ```

7. Publish a new version (see [RELEASING.md](RELEASING.md)). Done: the app now shows "Get LectureLab Pro — $5".

## Option B: Gumroad

The simplest to start with, and familiar to TikTok audiences. The fee is higher (about 10% + 50¢).

1. Create a product on **gumroad.com**: "LectureLab Pro", $5.
2. In the product's **Content** tab, turn on **"Generate a unique license key per sale"** and copy the **product ID** shown there.
3. Edit `src/lib/product.ts`:

   ```ts
   licenseProvider: "gumroad",
   buyUrl: "https://YOURNAME.gumroad.com/l/lecturelab",
   gumroad: { productId: "AbCdEf123==" },
   ```

4. Publish a new version.

## How students experience it

1. They download the free app from GitHub and use it.
2. When they hit a Pro feature (a 3rd course, a timed exam, the planner), an **Unlock Pro** window shows what Pro includes and a **Get Pro — $5** button.
3. They pay on the store's page and receive a key by email.
4. They paste the key into the window. Pro unlocks instantly and keeps working offline (it re-checks with the store every few days when online, with a 30-day offline grace period).
5. Moving to a new computer: **Settings → LectureLab Pro → Remove from this computer**, then enter the key on the new one.

## Honest notes

- **The code is public**, so a determined programmer could remove the key check. That's normal for open-source apps sold this way. People pay for convenience, updates and to support you, not because it's impossible to get around. Keep the price low, keep shipping features, and most people will pay.
- **Refunds:** if a store refunds a purchase, the key stops working at the next online check.
- **One-time vs. subscription:** $5 one-time is simple and fits "no server costs". If you later add big features, you can sell "Pro 2026" as a new product, or switch to a yearly subscription in the store (the app already respects ended subscriptions).
- Before selling, choose a code licence (see [BUSINESS.md](BUSINESS.md#open-decision-the-code-licence)).
