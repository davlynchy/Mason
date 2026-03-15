'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams, useSearchParams } from 'next/navigation';

type ContractType = 'subcontract' | 'head_contract';
type Jurisdiction = 'AU' | 'UK' | 'USA';
type AnalysisStage = 'preview' | 'full';

interface Risk {
  id: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  clause: string | null;
  impact: string;
  detail: string;
  recommendation: string;
}

interface ContractDetails {
  parties: string;
  contract_value: string | null;
  contract_type: string;
  key_dates: string;
}

interface FinancialSummary {
  contract_sum: string | null;
  payment_terms: string;
  liquidated_damages: string | null;
  retention: string | null;
  key_financial_risks: string[];
}

interface ReportData {
  id: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  paid: boolean;
  contractType: ContractType;
  jurisdiction: Jurisdiction;
  analysisStage: AnalysisStage;
  previewData: {
    executive_summary: string;
    contract_details: ContractDetails;
    risk_count: { high: number; medium: number; low: number };
    preview_risk: Risk | null;
  } | null;
  fullData: {
    risks: Risk[];
    financial_summary: FinancialSummary;
    immediate_actions: string[];
  } | null;
  errorMessage?: string;
}

const LEVEL_STYLES = {
  HIGH: 'border-red-200 bg-red-50 text-red-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  LOW: 'border-green-200 bg-green-50 text-green-700',
};

function jurisdictionLabel(jurisdiction: Jurisdiction) {
  switch (jurisdiction) {
    case 'AU':
      return 'Australian construction law';
    case 'UK':
      return 'UK construction law';
    case 'USA':
      return 'US construction law';
  }
}

function processingCopy(jurisdiction: Jurisdiction, paid: boolean) {
  if (paid) {
    return `Generating your full report against ${jurisdictionLabel(jurisdiction)}.`;
  }
  return `Generating your fast preview against ${jurisdictionLabel(jurisdiction)}.`;
}

function RiskBadge({ level }: { level: Risk['level'] }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${LEVEL_STYLES[level]}`}>
      {level}
    </span>
  );
}

function RiskCard({ risk }: { risk: Risk }) {
  return (
    <div className="rounded-2xl border border-mason-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs font-semibold text-mason-gray-400">{risk.id}</span>
        <RiskBadge level={risk.level} />
        {risk.clause ? <span className="text-xs text-mason-gray-400">{risk.clause}</span> : null}
      </div>
      <h3 className="text-base font-semibold text-mason-black">{risk.title}</h3>
      <p className="mt-2 text-sm text-mason-gray-700">{risk.impact}</p>
      <div className="mt-4 space-y-3">
        <p className="text-sm leading-relaxed text-mason-gray-600">{risk.detail}</p>
        <div className="rounded-xl bg-mason-gray-50 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">Recommended action</p>
          <p className="mt-1 text-sm text-mason-black">{risk.recommendation}</p>
        </div>
      </div>
    </div>
  );
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [fullAnalysisStarting, setFullAnalysisStarting] = useState(false);
  const [previewAnalysisStarting, setPreviewAnalysisStarting] = useState(false);
  const fullAnalysisRequested = useRef(false);
  const previewAnalysisRequested = useRef(false);

  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) {
        setLoading(false);
        return null;
      }
      const data: ReportData = await res.json();
      setReport(data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
      return null;
    }
  }, [id]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchReport();
      if (data && data.status !== 'processing' && data.status !== 'uploading') {
        clearInterval(interval);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchReport]);

  useEffect(() => {
    if (!report || report.previewData || report.status === 'processing' || previewAnalysisRequested.current) {
      return;
    }

    previewAnalysisRequested.current = true;
    setPreviewAnalysisStarting(true);

    void fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: id, stage: 'preview' }),
    })
      .catch(error => {
        console.error('Failed to start preview analysis', error);
      })
      .finally(() => {
        setPreviewAnalysisStarting(false);
        void fetchReport();
      });
  }, [fetchReport, id, report]);

  useEffect(() => {
    if (!report?.paid || report.fullData || report.status === 'processing' || fullAnalysisRequested.current) {
      return;
    }

    fullAnalysisRequested.current = true;
    setFullAnalysisStarting(true);

    void fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: id, stage: 'full' }),
    })
      .catch(error => {
        console.error('Failed to start full analysis', error);
      })
      .finally(() => {
        setFullAnalysisStarting(false);
        void fetchReport();
      });
  }, [fetchReport, id, report]);

  async function handleUpgrade() {
    setPaying(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setPaying(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-mason-black border-t-transparent" />
        <p className="text-sm text-mason-gray-500">Loading your report...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-lg font-semibold text-mason-black">Report not found</p>
          <a href="/" className="mt-2 inline-block text-sm text-mason-gray-500 underline">
            Start a new review
          </a>
        </div>
      </div>
    );
  }

  if (report.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
          <p className="text-lg font-semibold text-mason-black">Analysis failed</p>
          <p className="mt-3 text-sm leading-relaxed text-mason-gray-600">
            {report.errorMessage || 'Something went wrong while analysing your documents.'}
          </p>
          <a href="/" className="mt-5 inline-flex rounded-xl bg-mason-black px-5 py-3 text-sm font-semibold text-white">
            Start again
          </a>
        </div>
      </div>
    );
  }

  const isInitialProcessing = !report.previewData && (report.status === 'processing' || report.status === 'uploading' || previewAnalysisStarting);
  const isFullProcessing = !!report.previewData && report.paid && !report.fullData && (report.status === 'processing' || fullAnalysisStarting);

  if (isInitialProcessing) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <header className="border-b border-mason-gray-100 px-6 py-5">
          <Image src="/logo.svg?v=2" alt="Mason" width={180} height={40} className="h-8 w-auto" priority />
        </header>
        <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-2 border-mason-black border-t-transparent" />
          <div className="max-w-md">
            <p className="text-xl font-semibold text-mason-black">Preparing your preview</p>
            <p className="mt-3 text-sm leading-relaxed text-mason-gray-500">
              {processingCopy(report.jurisdiction, false)}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const preview = report.previewData;
  const full = report.fullData;
  const totalRisks = (preview?.risk_count.high ?? 0) + (preview?.risk_count.medium ?? 0) + (preview?.risk_count.low ?? 0);

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-mason-gray-100 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <Image src="/logo.svg?v=2" alt="Mason" width={180} height={40} className="h-8 w-auto" priority />
          {!report.paid ? (
            <button
              type="button"
              onClick={handleUpgrade}
              disabled={paying}
              className="rounded-xl bg-mason-black px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {paying ? 'Redirecting...' : 'Unlock Full Report - $799'}
            </button>
          ) : (
            <span className="text-sm font-semibold text-green-600">
              {full ? 'Full report unlocked' : 'Generating full report...'}
            </span>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        {searchParams.get('payment') === 'success' ? (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
            Payment received. Mason is now generating your full report.
          </div>
        ) : null}

        {preview ? (
          <>
            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-mason-gray-400">
                Contract Risk Review
              </p>
              <h1 className="mt-4 font-kanit text-4xl font-black text-mason-black">
                {preview.contract_details.contract_type || 'Contract preview'}
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-relaxed text-mason-gray-600">
                {preview.executive_summary}
              </p>
            </div>

            <div className="mb-8 grid gap-4 md:grid-cols-2">
              {[
                { label: 'Parties', value: preview.contract_details.parties },
                { label: 'Contract value', value: preview.contract_details.contract_value ?? 'Not specified' },
                { label: 'Contract type', value: report.contractType === 'subcontract' ? 'Subcontract' : 'Head contract' },
                { label: 'Jurisdiction', value: jurisdictionLabel(report.jurisdiction) },
                { label: 'Key dates', value: preview.contract_details.key_dates },
              ].map(item => (
                <div key={item.label} className="rounded-2xl bg-mason-gray-50 px-4 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">{item.label}</p>
                  <p className="mt-1 text-sm text-mason-black">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mb-8 rounded-2xl border border-mason-gray-100 p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">
                Preview summary - {totalRisks} risks identified
              </p>
              <div className="mt-4 grid grid-cols-3 gap-4">
                {[
                  { label: 'HIGH', count: preview.risk_count.high, tone: 'text-red-600' },
                  { label: 'MEDIUM', count: preview.risk_count.medium, tone: 'text-amber-600' },
                  { label: 'LOW', count: preview.risk_count.low, tone: 'text-green-600' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-mason-gray-50 px-4 py-4 text-center">
                    <p className={`font-kanit text-3xl font-black ${item.tone}`}>{item.count}</p>
                    <p className={`text-xs font-semibold ${item.tone}`}>{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {preview.preview_risk ? (
              <div className="mb-10">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="font-kanit text-2xl font-black text-mason-black">Fast Preview</h2>
                  {!report.paid ? (
                    <span className="rounded-full bg-mason-gray-100 px-3 py-1 text-xs font-semibold text-mason-gray-500">
                      First risk unlocked
                    </span>
                  ) : null}
                </div>
                <RiskCard risk={preview.preview_risk} />
              </div>
            ) : null}

            {isFullProcessing ? (
              <div className="mb-10 rounded-3xl border border-mason-gray-100 bg-mason-gray-50 p-8 text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-mason-black border-t-transparent" />
                <p className="text-lg font-semibold text-mason-black">Building your full report</p>
                <p className="mt-2 text-sm text-mason-gray-500">
                  {processingCopy(report.jurisdiction, true)}
                </p>
              </div>
            ) : null}

            {!report.paid ? (
              <div className="mb-10 rounded-3xl border-2 border-mason-black p-8 text-center">
                <p className="font-kanit text-2xl font-black text-mason-black">Unlock the full report</p>
                <p className="mt-3 text-sm leading-relaxed text-mason-gray-500">
                  The fast preview is ready. Unlock the complete risk register, financial summary, and action plan on demand.
                </p>
                <button
                  type="button"
                  onClick={handleUpgrade}
                  disabled={paying}
                  className="mt-5 rounded-xl bg-mason-black px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {paying ? 'Redirecting...' : 'Unlock Full Report - $799'}
                </button>
              </div>
            ) : null}

            {report.paid && full ? (
              <>
                <div className="mb-8">
                  <h2 className="mb-4 font-kanit text-2xl font-black text-mason-black">Full Risk Register</h2>
                  <div className="space-y-4">
                    {full.risks.map(risk => (
                      <RiskCard key={risk.id} risk={risk} />
                    ))}
                  </div>
                </div>

                <div className="mb-8 rounded-2xl border border-mason-gray-100 p-5">
                  <h2 className="mb-4 font-kanit text-2xl font-black text-mason-black">Financial Summary</h2>
                  <div className="grid gap-4 md:grid-cols-2">
                    {[
                      { label: 'Contract sum', value: full.financial_summary.contract_sum ?? 'Not specified' },
                      { label: 'Payment terms', value: full.financial_summary.payment_terms },
                      { label: 'Liquidated damages', value: full.financial_summary.liquidated_damages ?? 'Not specified' },
                      { label: 'Retention', value: full.financial_summary.retention ?? 'Not specified' },
                    ].map(item => (
                      <div key={item.label}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">{item.label}</p>
                        <p className="mt-1 text-sm text-mason-black">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">Key financial risks</p>
                    <ul className="mt-2 space-y-2">
                        {full.financial_summary.key_financial_risks.map((item, index) => (
                          <li key={`${item}-${index}`} className="text-sm text-mason-gray-700">
                            - {item}
                          </li>
                        ))}
                    </ul>
                  </div>
                </div>

                <div className="rounded-2xl border border-mason-gray-100 p-5">
                  <h2 className="mb-4 font-kanit text-2xl font-black text-mason-black">Immediate Actions</h2>
                  <ol className="space-y-3">
                    {full.immediate_actions.map((item, index) => (
                      <li key={`${item}-${index}`} className="flex gap-3 text-sm text-mason-gray-700">
                        <span className="font-kanit text-lg font-black text-mason-gray-300">{String(index + 1).padStart(2, '0')}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
