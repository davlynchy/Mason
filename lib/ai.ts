import OpenAI from 'openai';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { downloadFromR2 } from './r2';

export type Jurisdiction = 'AU' | 'UK' | 'USA';
export type AnalysisStage = 'preview' | 'full';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MIN_EMBEDDED_PDF_TEXT = 1200;
const MAX_TEXT_CHARS_PER_FILE = 50000;

interface ExtractedFile {
  fileData?: string;
  filename?: string;
  text?: string;
  base64?: string;
  mediaType?: string;
}

export interface RiskItem {
  id: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  clause: string | null;
  impact: string;
  detail: string;
  recommendation: string;
}

export interface PreviewAnalysisResult {
  executive_summary: string;
  contract_details: {
    parties: string;
    contract_value: string | null;
    contract_type: string;
    key_dates: string;
  };
  risk_count: { high: number; medium: number; low: number };
  preview_risk: RiskItem | null;
}

export interface FullAnalysisResult {
  risks: RiskItem[];
  financial_summary: {
    contract_sum: string | null;
    payment_terms: string;
    liquidated_damages: string | null;
    retention: string | null;
    key_financial_risks: string[];
  };
  immediate_actions: string[];
}

function getJurisdictionLabel(jurisdiction: Jurisdiction): string {
  switch (jurisdiction) {
    case 'AU':
      return 'Australian construction law';
    case 'UK':
      return 'UK construction law';
    case 'USA':
      return 'United States construction law';
  }
}

function getJurisdictionRules(jurisdiction: Jurisdiction): string[] {
  switch (jurisdiction) {
    case 'AU':
      return [
        'AS4000-1997, AS2124-1992, AS4300-1995, AS2545-1993, ABIC contracts',
        'Security of Payment legislation across Australian states and territories',
        'Common subcontractor risks in Australian construction contracts',
      ];
    case 'UK':
      return [
        'JCT, NEC, and bespoke UK construction contracts',
        'Housing Grants, Construction and Regeneration Act 1996 and adjudication regime',
        'Payment notice, pay less notice, set-off, and extension-of-time risks in UK construction contracts',
      ];
    case 'USA':
      return [
        'AIA, ConsensusDocs, EJCDC, and bespoke US construction contracts',
        'State-by-state prompt payment, lien, indemnity, and pay-if-paid or pay-when-paid issues',
        'Common US subcontractor and general contractor allocation-of-risk clauses',
      ];
  }
}

function buildSystemPrompt(jurisdiction: Jurisdiction): string {
  const rules = getJurisdictionRules(jurisdiction)
    .map(rule => `- ${rule}`)
    .join('\n');

  return `You are Mason, an expert construction contract analyst with deep knowledge of ${getJurisdictionLabel(jurisdiction)}.

You analyse construction contracts from the perspective of the party engaging you. You identify materially risky clauses, explain the commercial impact, and provide direct negotiation recommendations.

Your knowledge includes:
${rules}

CRITICAL RULES:
1. NEVER hallucinate. Only report what is actually in the documents provided.
2. Be specific about clause numbers whenever possible.
3. If a document is unreadable or too brief, say so.
4. For HIGH risks, be direct and unambiguous about the financial exposure.
5. Recommendations must be specific and actionable.
6. Return ONLY valid JSON - no preamble, no markdown, no code fences.`;
}

function buildPreviewPrompt(
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction
): string {
  const perspective = contractType === 'subcontract'
    ? 'subcontractor'
    : 'head contractor / main contractor';

  return `You are acting for the ${perspective}.

Review the provided contract under ${getJurisdictionLabel(jurisdiction)} and return a FAST PREVIEW in this exact JSON shape:

{
  "executive_summary": "2-4 direct sentences",
  "contract_details": {
    "parties": "Parties as stated, or 'Not clearly identified'",
    "contract_value": "Contract sum as stated, or null",
    "contract_type": "Type of contract as stated",
    "key_dates": "Important dates as stated, or 'Not clearly stated'"
  },
  "risk_count": {
    "high": <integer>,
    "medium": <integer>,
    "low": <integer>
  },
  "preview_risk": {
    "id": "R01",
    "level": "HIGH",
    "title": "Short title",
    "clause": "Clause reference or null",
    "impact": "One-sentence impact",
    "detail": "2-4 sentence explanation",
    "recommendation": "Specific action"
  }
}

Requirements:
- Prioritise speed and the single most important risk.
- Estimate total risk counts across the contract even if you only fully explain one risk.
- If no HIGH risk exists, use the most important MEDIUM risk as preview_risk.
- If the contract is unreadable, say so in executive_summary and set preview_risk to null.`;
}

function buildFullPrompt(
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction
): string {
  const perspective = contractType === 'subcontract'
    ? 'subcontractor'
    : 'head contractor / main contractor';

  return `You are acting for the ${perspective}.

Analyse all documents under ${getJurisdictionLabel(jurisdiction)} and return the FULL report in this exact JSON shape:

{
  "risks": [
    {
      "id": "R01",
      "level": "HIGH",
      "title": "Short title",
      "clause": "Clause reference or null",
      "impact": "One-sentence impact",
      "detail": "2-4 sentence explanation",
      "recommendation": "Specific action"
    }
  ],
  "financial_summary": {
    "contract_sum": "Contract sum or null",
    "payment_terms": "Payment terms as stated",
    "liquidated_damages": "LD regime or null",
    "retention": "Retention regime or null",
    "key_financial_risks": [
      "Risk bullet 1",
      "Risk bullet 2"
    ]
  },
  "immediate_actions": [
    "Specific action 1",
    "Specific action 2",
    "Specific action 3",
    "Specific action 4",
    "Specific action 5"
  ]
}

Requirements:
- Return ALL HIGH risks first, then MEDIUM, then LOW.
- Focus on legally and commercially material issues.
- Keep IDs stable and sequential.
- Minimum of 5 risks if this is a substantive contract.`;
}

function cleanJsonResponse(raw: string): string {
  return raw
    .replace(/^```json\s*/m, '')
    .replace(/^```\s*/m, '')
    .replace(/```\s*$/m, '')
    .trim();
}

async function extractFileForAnalysis(r2Key: string, filename: string): Promise<ExtractedFile> {
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

      if (text && text.length >= MIN_EMBEDDED_PDF_TEXT) {
        return { text };
      }

      return {
        filename,
        fileData: `data:application/pdf;base64,${buffer.toString('base64')}`,
        text: text
          ? `[Limited embedded text was extracted from ${filename}. Use the native PDF input for OCR/page understanding as the source of truth.]\n\n${text.slice(0, 8000)}`
          : `[No embedded text was extracted from ${filename}. Use the native PDF input for OCR/page understanding as the source of truth.]`,
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
    return { text: `[Excel file: ${filename}. Content extraction is limited. Use only clearly readable financial or schedule information that appears in the extracted content.]` };
  }

  return { text: `[Unsupported file type: ${filename}]` };
}

async function buildMessages(
  r2Keys: string[],
  filenames: string[],
  systemPrompt: string,
  userPrompt: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
  ];

  for (let i = 0; i < r2Keys.length; i++) {
    const key = r2Keys[i];
    const filename = filenames[i] ?? `file_${i + 1}`;

    messages.push({
      role: 'user',
      content: `\n--- Document ${i + 1}: ${filename} ---\n`,
    });

    try {
      const extracted = await extractFileForAnalysis(key, filename);

      if (extracted.fileData && extracted.filename) {
        const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

        if (extracted.text) {
          content.push({
            type: 'text',
            text: extracted.text,
          });
        }

        content.push({
          type: 'file',
          file: {
            filename: extracted.filename,
            file_data: extracted.fileData,
          },
        } as never);

        messages.push({ role: 'user', content });
      } else if (extracted.base64 && extracted.mediaType) {
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
      } else if (extracted.text) {
        messages.push({
          role: 'user',
          content: extracted.text.slice(0, MAX_TEXT_CHARS_PER_FILE),
        });
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
    content: userPrompt,
  });

  return messages;
}

async function runModel<T>(
  r2Keys: string[],
  filenames: string[],
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number
): Promise<T> {
  const messages = await buildMessages(r2Keys, filenames, systemPrompt, userPrompt);

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: maxTokens,
    messages,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  return JSON.parse(cleanJsonResponse(raw)) as T;
}

export async function analysePreviewContract(
  r2Keys: string[],
  filenames: string[],
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction
): Promise<PreviewAnalysisResult> {
  const result = await runModel<PreviewAnalysisResult>(
    r2Keys,
    filenames,
    buildSystemPrompt(jurisdiction),
    buildPreviewPrompt(contractType, jurisdiction),
    2200
  );

  return {
    executive_summary: result.executive_summary,
    contract_details: result.contract_details,
    risk_count: result.risk_count,
    preview_risk: result.preview_risk,
  };
}

export async function analyseFullContract(
  r2Keys: string[],
  filenames: string[],
  contractType: 'subcontract' | 'head_contract',
  jurisdiction: Jurisdiction
): Promise<FullAnalysisResult> {
  const result = await runModel<FullAnalysisResult>(
    r2Keys,
    filenames,
    buildSystemPrompt(jurisdiction),
    buildFullPrompt(contractType, jurisdiction),
    5000
  );

  if (!result.risks || !Array.isArray(result.risks)) {
    throw new Error('AI returned invalid structure - no risks array');
  }

  const ordered = [...result.risks].sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return order[a.level] - order[b.level];
  });

  return {
    risks: ordered,
    financial_summary: result.financial_summary,
    immediate_actions: result.immediate_actions,
  };
}
