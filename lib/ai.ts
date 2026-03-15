import OpenAI from 'openai';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { downloadFromR2 } from './r2';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MIN_PDF_TEXT_LENGTH = 500;
const MAX_SCANNED_PDF_PAGES = 12;
const PDF_IMAGE_WIDTH = 1400;

interface ExtractedImage {
  base64: string;
  mediaType: string;
  pageNumber?: number;
}

interface ExtractedFile {
  text?: string;
  base64?: string;
  mediaType?: string;
  images?: ExtractedImage[];
}

export async function extractTextFromFile(
  r2Key: string,
  filename: string
): Promise<ExtractedFile> {
  const buffer = await downloadFromR2(r2Key);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (ext === 'docx' || ext === 'doc') {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value };
  }

  if (ext === 'csv' || ext === 'txt') {
    return { text: buffer.toString('utf-8') };
  }

  if (ext === 'pdf') {
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      const text = result.text?.trim();

      if (text && text.length >= MIN_PDF_TEXT_LENGTH) {
        return { text };
      }

      const screenshots = await parser.getScreenshot({
        first: MAX_SCANNED_PDF_PAGES,
        desiredWidth: PDF_IMAGE_WIDTH,
        imageDataUrl: false,
        imageBuffer: true,
      });

      const images = screenshots.pages.map(page => ({
        base64: Buffer.from(page.data).toString('base64'),
        mediaType: 'image/png',
        pageNumber: page.pageNumber,
      }));

      const notes: string[] = [];
      if (text) {
        notes.push(
          `[Partial PDF text extracted from ${filename}. The document may be scanned or image-based, so rendered page images are included for OCR-style analysis.]`
        );
        notes.push(text.slice(0, 12000));
      } else {
        notes.push(
          `[No embedded PDF text was found in ${filename}. Using rendered page images for OCR-style analysis instead.]`
        );
      }

      if (screenshots.total > MAX_SCANNED_PDF_PAGES) {
        notes.push(
          `[Only the first ${MAX_SCANNED_PDF_PAGES} pages were rendered for this scanned PDF. Split very large scanned contracts into logical sections for better speed and completeness.]`
        );
      }

      if (images.length > 0) {
        return {
          text: notes.join('\n\n'),
          images,
        };
      }

      return {
        text: `[PDF file: ${filename}. Text extraction returned no readable text. The file may be scanned or image-only.]`,
      };
    } catch (error) {
      return {
        text: `[PDF file: ${filename}. Text extraction failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }]`,
      };
    } finally {
      await parser.destroy();
    }
  }

  const imageTypes: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    heic: 'image/heic',
  };

  if (imageTypes[ext]) {
    return {
      base64: buffer.toString('base64'),
      mediaType: imageTypes[ext],
    };
  }

  if (ext === 'xlsx' || ext === 'xls') {
    return { text: `[Excel file: ${filename}. Content extraction limited in this version.]` };
  }

  return { text: `[Unsupported file type: ${filename}]` };
}

const SYSTEM_PROMPT = `You are Mason, an expert construction contract analyst with deep knowledge of Australian construction law.

You analyse construction contracts from the perspective of the party engaging you (subcontractor or head contractor). You identify every risk, flag clauses that are commercially onerous, and give specific, actionable recommendations.

Your knowledge includes:
- AS4000-1997, AS2124-1992, AS4300-1995, AS2545-1993, ABIC contracts
- Building and Construction Industry (Security of Payment) Act 2021 (WA)
- Building and Construction Industry Security of Payment Act 1999 (NSW)
- Building Industry Fairness (Security of Payment) Act 2017 (QLD)
- Security of Payment Acts for all other Australian states and territories
- Standard subcontractor rights: EOT notices, variation entitlements, suspension rights, adjudication
- Common risk areas: NIL delay costs, uncapped LDs, scope catch-alls, pay-when-paid clauses, set-off rights, insurance requirements, retention terms

CRITICAL RULES:
1. NEVER hallucinate. Only report what is actually in the documents provided.
2. Be specific about clause numbers whenever possible.
3. If a document is unreadable or too brief, say so.
4. For HIGH risks, be direct and unambiguous about the financial exposure.
5. Recommendations must be specific and actionable (e.g. "Negotiate deletion of Clause 12.3" not "Review this clause").
6. Return ONLY valid JSON - no preamble, no markdown, no code fences.`;

function buildUserPrompt(contractType: 'subcontract' | 'head_contract'): string {
  const perspective = contractType === 'subcontract'
    ? "subcontractor - analyse this subcontract to protect the subcontractor's commercial position"
    : "main contractor / head contractor - analyse this head contract to protect the contractor's position";

  return `You are acting for the ${perspective}.

Analyse ALL documents provided and return a comprehensive risk review in this EXACT JSON format:

{
  "executive_summary": "2-4 sentence summary of the contract and overall risk profile. Be direct.",
  "contract_details": {
    "parties": "Head contractor and subcontractor names as stated",
    "contract_value": "The contract sum or subcontract sum as stated, or null if not found",
    "contract_type": "Type of contract (e.g. AS4000 Amended Subcontract, lump sum, etc.)",
    "key_dates": "Any identified dates - SC date, practical completion, programme dates"
  },
  "risk_count": {
    "high": <integer>,
    "medium": <integer>,
    "low": <integer>
  },
  "risks": [
    {
      "id": "R01",
      "level": "HIGH",
      "title": "Short descriptive title (max 10 words)",
      "clause": "Clause X.X or Annexure Part X, or null",
      "impact": "One sentence describing the commercial or financial impact if this risk materialises",
      "detail": "2-4 sentences of detailed analysis. Quote the relevant clause text where possible. Explain WHY this is a risk.",
      "recommendation": "Specific recommended action - what to negotiate, what to include, what to do before signing. Be concrete."
    }
  ],
  "financial_summary": {
    "contract_sum": "The contract or subcontract sum, or null",
    "payment_terms": "Payment period and method as stated (e.g. '25 business days from claim')",
    "liquidated_damages": "LD rate and any cap, or null if not stated",
    "retention": "Retention rate, cap amount, and release terms, or null",
    "key_financial_risks": [
      "Brief bullet of key financial risk 1",
      "Brief bullet of key financial risk 2"
    ]
  },
  "immediate_actions": [
    "Specific action 1 to take before signing",
    "Specific action 2",
    "Specific action 3",
    "Specific action 4",
    "Specific action 5"
  ]
}

RISK CLASSIFICATION GUIDE:
- HIGH: Direct financial exposure, rights-waiving clauses, programme issues that are already locked in, uncapped liability, NIL delay costs, severely one-sided payment terms, missing SOP Act protections
- MEDIUM: Notice period traps, variation omission rights, painting/interface risks, termination for convenience with limited payment, sub-subcontractor consent requirements, insurance gaps
- LOW: Below-market rates, retention without bonding, minor ambiguities, standard clauses that are unfavourable but not unusual

PRIORITY RISKS TO LOOK FOR (for subcontracts):
1. NIL delay costs or delay cost caps
2. Uncapped liquidated damages
3. Programme already behind before signing (SC date unachievable)
4. Pay-when-paid / pay-if-paid clauses
5. Entire agreement clauses wiping out subcontractor's own T&Cs
6. Scope catch-alls ("reasonable subcontractor" standard)
7. EOT notice periods shorter than 7 days
8. Retention held in cash without security
9. Slow payment periods (beyond 15 business days)
10. Set-off rights without limitation
11. Right of omission without margin protection
12. Termination for convenience with no lost-profit compensation
13. Uncapped indemnities
14. Fixed price with no rise-and-fall provision

Order risks: ALL HIGH risks first (sorted by severity), then ALL MEDIUM, then ALL LOW.
Minimum: identify at least 5 risks if the document is a real contract. If fewer than 5 risks exist, the document is likely not a contract.`;
}

export interface AnalysisResult {
  executive_summary: string;
  contract_details: {
    parties: string;
    contract_value: string | null;
    contract_type: string;
    key_dates: string;
  };
  risk_count: { high: number; medium: number; low: number };
  risks: Array<{
    id: string;
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    clause: string | null;
    impact: string;
    detail: string;
    recommendation: string;
  }>;
  financial_summary: {
    contract_sum: string | null;
    payment_terms: string;
    liquidated_damages: string | null;
    retention: string | null;
    key_financial_risks: string[];
  };
  immediate_actions: string[];
}

export async function analyseContract(
  r2Keys: string[],
  filenames: string[],
  contractType: 'subcontract' | 'head_contract'
): Promise<AnalysisResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  for (let i = 0; i < r2Keys.length; i++) {
    const key = r2Keys[i];
    const filename = filenames[i] ?? `file_${i + 1}`;

    messages.push({
      role: 'user',
      content: `\n--- Document ${i + 1}: ${filename} ---\n`,
    });

    try {
      const extracted = await extractTextFromFile(key, filename);

      if (extracted.base64 && extracted.mediaType) {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${extracted.mediaType};base64,${extracted.base64}`,
              },
            },
          ],
        });
      } else if (extracted.images?.length) {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

        if (extracted.text) {
          content.push({
            type: 'text',
            text: extracted.text,
          });
        }

        for (const image of extracted.images) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${image.mediaType};base64,${image.base64}`,
            },
          });
        }

        messages.push({
          role: 'user',
          content,
        });
      } else if (extracted.text) {
        const truncated = extracted.text.slice(0, 80000);
        messages.push({ role: 'user', content: truncated });
      }
    } catch (err) {
      messages.push({
        role: 'user',
        content: `[Error reading ${filename}: ${err instanceof Error ? err.message : 'unknown error'}]`,
      });
    }
  }

  messages.push({
    role: 'user',
    content: buildUserPrompt(contractType),
  });

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 8192,
    messages,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  const cleaned = raw
    .replace(/^```json\s*/m, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();

  const result: AnalysisResult = JSON.parse(cleaned);

  if (!result.risks || !Array.isArray(result.risks)) {
    throw new Error('AI returned invalid structure - no risks array');
  }

  return result;
}

export function splitAnalysis(result: AnalysisResult) {
  const ordered = [...result.risks].sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return order[a.level] - order[b.level];
  });

  const previewRisk = ordered[0] ?? null;

  const previewData = {
    executive_summary: result.executive_summary,
    contract_details: result.contract_details,
    risk_count: result.risk_count,
    preview_risk: previewRisk,
  };

  const fullData = {
    risks: ordered,
    financial_summary: result.financial_summary,
    immediate_actions: result.immediate_actions,
  };

  return { previewData, fullData };
}
