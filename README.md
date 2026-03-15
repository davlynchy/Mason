# Mason

AI-powered contract review for construction professionals.

## What It Does

Mason lets a user:

1. Upload contract documents directly to Cloudflare R2
2. Create an account or log back in as a returning customer
3. Choose the legal jurisdiction for review: `AU`, `UK`, or `USA`
4. Receive a fast preview first:
   - executive summary
   - contract details
   - total risk counts
   - first key risk
5. Unlock the full report after payment:
   - complete risk register
   - financial summary
   - immediate action plan

## Stack

| Layer | Service |
|---|---|
| Frontend + API | Next.js 14 App Router |
| Auth + Database | Supabase |
| File Storage | Cloudflare R2 |
| AI Analysis | OpenAI |
| Payments | Stripe Checkout |

## Key Product Flow

### New customer

1. Upload files
2. Fill in signup form
3. Pick jurisdiction and contract type
4. Mason runs a fast preview analysis
5. User sees preview immediately
6. User pays to unlock the full report
7. Mason runs the full analysis only after payment

### Returning customer

1. Log in with existing email and password
2. Jump to the latest report
3. If already paid, full report is shown
4. If not yet paid, preview is shown and full report can be unlocked

## Setup

### 1. Install

```bash
npm install
```

Create `.env.local` from `.env.example`.

### 2. Supabase

Create a Supabase project, then run:

- [supabase/migrations/001_initial.sql](/c:/Users/DavidLynch/mason-mvp/supabase/migrations/001_initial.sql)
- [supabase/migrations/002_add_jurisdiction_and_analysis_stage.sql](/c:/Users/DavidLynch/mason-mvp/supabase/migrations/002_add_jurisdiction_and_analysis_stage.sql)

Important:
- `001_initial.sql` is for fresh setup
- `002_add_jurisdiction_and_analysis_stage.sql` must also be run if your database was created before the staged-analysis upgrade

### 3. Cloudflare R2

Configure a bucket and enable CORS similar to:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://gomason.ai"
    ],
    "AllowedMethods": [
      "GET",
      "PUT",
      "HEAD"
    ],
    "AllowedHeaders": [
      "*"
    ],
    "ExposeHeaders": [
      "ETag"
    ],
    "MaxAgeSeconds": 3600
  }
]
```

Recommended env setup:

```env
CLOUDFLARE_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CLOUDFLARE_R2_BUCKET_NAME=<bucket-name>
CLOUDFLARE_R2_ACCESS_KEY_ID=...
CLOUDFLARE_R2_SECRET_ACCESS_KEY=...
```

### 4. OpenAI

Add an OpenAI API key:

```env
OPENAI_API_KEY=sk-...
```

### 5. Stripe

Add:

```env
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

### 6. App env

At minimum:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

OPENAI_API_KEY=sk-...

NEXT_PUBLIC_APP_URL=http://localhost:3000
REPORT_PRICE_AUD=79900
```

## Run Locally

```bash
npm run dev
```

Open `http://localhost:3000`.

## Notes

### Why staged analysis?

Full AI analysis on large contracts can take a while. Mason now:

- returns a fast preview first
- defers the heavy full report until after payment

This improves perceived speed and reduces wasted compute.

### Scanned PDFs

Mason uses:

- local text extraction for normal text-based PDFs
- native PDF input to OpenAI when embedded text is limited

That gives better coverage for scanned contracts than the earlier placeholder-only flow.

### Deployment

The analysis route can be long-running. Keep the timeout in [vercel.json](/c:/Users/DavidLynch/mason-mvp/vercel.json) aligned with that.
