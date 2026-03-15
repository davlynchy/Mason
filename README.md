# Mason — Contract Risk Review MVP

**gomason.ai** · AI-powered contract analysis for construction professionals

---

## What This Builds

A single-page landing site where:
1. User drops contract documents (up to 1 GB, any combination of PDF / DOCX / XLSX / PNG / JPG)
2. Fills in a short registration form + selects subcontract or head contract
3. Files upload directly to Cloudflare R2 (presigned PUT — bypasses your server entirely)
4. Claude Sonnet analyses all documents against Australian construction law
5. Report page shows free preview (exec summary + first HIGH risk)
6. Stripe payment unlocks the full risk register + financial summary + action plan

---

## Stack

| Layer | Service |
|-------|---------|
| Frontend + API | Next.js 14 (App Router) on Vercel |
| Auth + Database | Supabase |
| File Storage | Cloudflare R2 (zero egress fees) |
| AI Analysis | Anthropic Claude claude-sonnet-4-20250514 |
| Payments | Stripe Checkout |

---

## Setup

### 1. Clone and install

```bash
git clone <your-repo>
cd mason-mvp
npm install
cp .env.example .env.local
```

### 2. Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **Database → SQL Editor → New query**
3. Paste and run the contents of `supabase/migrations/001_initial.sql`
4. Copy your project URL and keys from **Settings → API**

### 3. Cloudflare R2

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **R2**
2. Create a bucket: `mason-contracts`
3. Create an API token with **Object Read & Write** permissions
4. Enable **CORS** on the bucket:

```json
[
  {
    "AllowedOrigins": ["https://gomason.ai", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "MaxAgeSeconds": 3600
  }
]
```

5. Copy Account ID, Access Key ID, Secret Access Key into `.env.local`

### 4. Anthropic API

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an API key
3. Add to `.env.local` as `ANTHROPIC_API_KEY`

### 5. Stripe

1. Create account at [stripe.com](https://stripe.com)
2. Copy publishable key and secret key (use test keys first)
3. Set up webhook:
   - **Developers → Webhooks → Add endpoint**
   - URL: `https://gomason.ai/api/webhook`
   - Events: `checkout.session.completed`
   - Copy webhook signing secret

### 6. Fill in .env.local

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

CLOUDFLARE_R2_ACCOUNT_ID=abc123
CLOUDFLARE_R2_ACCESS_KEY_ID=xxx
CLOUDFLARE_R2_SECRET_ACCESS_KEY=xxx
CLOUDFLARE_R2_BUCKET_NAME=mason-contracts

ANTHROPIC_API_KEY=sk-ant-...

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...

NEXT_PUBLIC_APP_URL=http://localhost:3000
REPORT_PRICE_AUD=79900
```

### 7. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Add all environment variables in Vercel dashboard → **Settings → Environment Variables**

**Important for Vercel:** The `/api/analyse` route can take up to 5 minutes. Set function timeout in `vercel.json`:

```json
{
  "functions": {
    "app/api/analyse/route.ts": {
      "maxDuration": 300
    }
  }
}
```

---

## Architecture Notes

### Why direct-to-R2 uploads?
Files go **browser → R2** via presigned PUT URL. Your server never touches the file bytes. This means:
- No 4.5 MB serverless body limit issue
- Files of 1 GB+ work without any special config
- Upload speed is maximised (no server hop)

### How the analysis works
1. Each file is downloaded from R2 server-side (inside the `/api/analyse` route)
2. PDFs → sent as native PDF document blocks to Claude
3. Images → sent as base64 image blocks (Claude Vision)
4. DOCX → converted to plain text via mammoth
5. All content assembled into a single Claude message
6. Claude returns structured JSON matching the risk review schema
7. Preview data (exec summary + first risk) saved separately from full data
8. Full data only returned to the frontend if `paid = true`

### Paywall
- Free: executive summary + risk counts + first HIGH risk (full detail)
- Paid ($799): complete risk register + financial summary + action plan
- Blur effect + unlock modal covers subsequent risks
- Stripe Checkout → webhook → `paid = true` on the report record

---

## File Structure

```
mason-mvp/
├── app/
│   ├── page.tsx                    ← Landing page + upload + registration
│   ├── report/[id]/page.tsx        ← Report with paywall
│   ├── globals.css
│   ├── layout.tsx
│   └── api/
│       ├── upload-url/route.ts     ← Generate presigned R2 PUT URL
│       ├── reports/
│       │   ├── route.ts            ← POST: create user + report
│       │   └── [id]/route.ts       ← GET: fetch report status
│       ├── analyse/route.ts        ← POST: trigger AI analysis
│       ├── checkout/route.ts       ← POST: Stripe checkout session
│       └── webhook/route.ts        ← POST: Stripe webhook (mark paid)
├── lib/
│   ├── supabase.ts                 ← Supabase clients + types
│   ├── r2.ts                       ← Cloudflare R2 helpers
│   └── ai.ts                       ← Claude analysis engine + prompts
├── public/
│   ├── logo.png
│   └── favicon.png
└── supabase/
    └── migrations/001_initial.sql  ← Full database schema
```

---

## Phase 2 Extensions

- Email confirmation + magic link access to saved reports
- PDF download of full report (using Puppeteer or react-pdf)
- Dashboard: list of all reports for logged-in user
- Webhook: send report-ready email notification
- Multi-jurisdiction: UK (HGCRA) and US (lien law) modes
- Saved report access via unique link (no login required)
