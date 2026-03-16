'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

type ContractType = 'subcontract' | 'head_contract';
type Jurisdiction = 'AU' | 'UK' | 'USA';
type AnalysisStage = 'preview' | 'full';
type ProcessingPhase =
  | 'queued'
  | 'extracting'
  | 'summarising'
  | 'counting'
  | 'top_risk'
  | 'complete'
  | 'error';

interface Risk {
  id: string;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  clause: string | null;
  impact: string;
  detail: string;
  recommendation: string;
  source_pages?: number[] | null;
  source_excerpt?: string | null;
  finding_origin?: 'rule' | 'ai' | null;
  rule_basis?: string | null;
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
    executive_summary?: string;
    contract_details?: ContractDetails;
    risk_count?: { high: number; medium: number; low: number };
    preview_risk?: Risk | null;
  } | null;
  fullData: {
    risks: Risk[];
    financial_summary: FinancialSummary;
    immediate_actions: string[];
  } | null;
  errorMessage?: string | null;
  processingPhase?: ProcessingPhase | null;
  processingMessage?: string | null;
  processingError?: string | null;
  processingStartedAt?: string | null;
  processingUpdatedAt?: string | null;
}

const LEVEL_STYLES = {
  HIGH: 'border-red-200 bg-red-50 text-red-700',
  MEDIUM: 'border-amber-200 bg-amber-50 text-amber-700',
  LOW: 'border-green-200 bg-green-50 text-green-700',
};

const PREVIEW_STEPS: Array<{ phase: ProcessingPhase; label: string }> = [
  { phase: 'queued', label: 'Queued' },
  { phase: 'extracting', label: 'Extracting text' },
  { phase: 'summarising', label: 'Writing summary' },
  { phase: 'counting', label: 'Mapping counts' },
  { phase: 'top_risk', label: 'Explaining top risk' },
];

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

function processingCopy(report: ReportData) {
  if (report.processingMessage) {
    return report.processingMessage;
  }

  if (report.paid) {
    return `Generating your full report against ${jurisdictionLabel(report.jurisdiction)}.`;
  }

  return `Generating your fast preview against ${jurisdictionLabel(report.jurisdiction)}.`;
}

function BrandLogo() {
  return <img src="/logo.svg?v=3" alt="Mason" className="h-8 w-auto" />;
}

function RiskBadge({ level }: { level: Risk['level'] }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${LEVEL_STYLES[level]}`}>
      {level}
    </span>
  );
}

function findingOrigin(risk: Risk) {
  if (risk.finding_origin === 'rule' || /^[A-Z]{2,3}\d+/.test(risk.id)) {
    return 'Rule-based';
  }

  return 'AI analysis';
}

function RiskCard({ risk }: { risk: Risk }) {
  return (
    <div className="rounded-2xl border border-mason-gray-100 bg-white p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs font-semibold text-mason-gray-400">{risk.id}</span>
        <RiskBadge level={risk.level} />
        <span className="rounded-full bg-mason-gray-100 px-2.5 py-1 text-xs font-semibold text-mason-gray-500">
          {findingOrigin(risk)}
        </span>
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
        {risk.finding_origin === 'rule' && risk.rule_basis ? (
          <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-500">Rule basis</p>
            <p className="mt-1 text-sm text-blue-900">{risk.rule_basis}</p>
          </div>
        ) : null}
        {risk.source_excerpt || risk.source_pages?.length ? (
          <div className="rounded-xl border border-mason-gray-100 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-mason-gray-400">Source</p>
            {risk.source_pages?.length ? (
              <p className="mt-1 text-xs text-mason-gray-500">Pages {risk.source_pages.join(', ')}</p>
            ) : null}
            {risk.source_excerpt ? (
              <p className="mt-2 text-sm text-mason-gray-700">&quot;{risk.source_excerpt}&quot;</p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-mason-gray-50 ${className}`} />;
}

export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [startingPreview, setStartingPreview] = useState(false);
  const [fullAnalysisStarting, setFullAnalysisStarting] = useState(false);
  const [streamFallback, setStreamFallback] = useState(false);
  const previewAnalysisRequested = useRef(false);
  const fullAnalysisRequested = useRef(false);

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

  const startAnalysis = useCallback(async (stage: AnalysisStage) => {
    const res = await fetch('/api/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reportId: id, stage }),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data?.error || 'Failed to start analysis');
    }

    if (data?.report) {
      setReport(data.report as ReportData);
    } else {
      await fetchReport();
    }
  }, [fetchReport, id]);

  useEffect(() => {
    void fetchReport();
  }, [fetchReport]);

  useEffect(() => {
    if (!id || typeof EventSource === 'undefined') {
      setStreamFallback(true);
      return;
    }

    const source = new EventSource(`/api/reports/${id}/events`);

    source.addEventListener('report', event => {
      const nextReport = JSON.parse((event as MessageEvent).data) as ReportData;
      setReport(nextReport);
      setLoading(false);

      if (nextReport.status === 'complete' || nextReport.status === 'error') {
        source.close();
      }
    });

    source.addEventListener('error', () => {
      setStreamFallback(true);
      source.close();
    });

    return () => {
      source.close();
    };
  }, [id]);

  useEffect(() => {
    if (!streamFallback || !report || (report.status !== 'processing' && report.status !== 'uploading')) {
      return;
    }

    const interval = setInterval(() => {
      void fetchReport();
    }, 2000);

    return () => clearInterval(interval);
  }, [fetchReport, report, streamFallback]);

  useEffect(() => {
    if (!report) {
      return;
    }

    if (report.status === 'error') {
      return;
    }

    const hasPreviewStarted = !!report.previewData || report.status === 'processing';
    if (hasPreviewStarted || previewAnalysisRequested.current || report.analysisStage === 'full') {
      return;
    }

    previewAnalysisRequested.current = true;
    setStartingPreview(true);

    void startAnalysis('preview')
      .catch(error => {
        setReport(prev => prev ? {
          ...prev,
          status: 'error',
          processingError: error instanceof Error ? error.message : 'Failed to start preview',
          errorMessage: error instanceof Error ? error.message : 'Failed to start preview',
        } : prev);
      })
      .finally(() => {
        setStartingPreview(false);
      });
  }, [report, startAnalysis]);

  useEffect(() => {
    if (!report?.paid || report.fullData || report.status === 'processing' || fullAnalysisRequested.current) {
      return;
    }

    fullAnalysisRequested.current = true;
    setFullAnalysisStarting(true);

    void startAnalysis('full')
      .catch(error => {
        console.error('Failed to start full analysis', error);
      })
      .finally(() => {
        setFullAnalysisStarting(false);
      });
  }, [report, startAnalysis]);

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

  async function handleRetryPreview() {
    previewAnalysisRequested.current = false;
    setStartingPreview(true);

    try {
      await startAnalysis('preview');
    } finally {
      setStartingPreview(false);
    }
  }

  const preview = report?.previewData;
  const full = report?.fullData;
  const totalRisks = useMemo(() => (
    (preview?.risk_count?.high ?? 0) +
    (preview?.risk_count?.medium ?? 0) +
    (preview?.risk_count?.low ?? 0)
  ), [preview]);

  const currentStepIndex = PREVIEW_STEPS.findIndex(step => step.phase === report?.processingPhase);
  const slowContract = !!report?.processingStartedAt &&
    (Date.now() - new Date(report.processingStartedAt).getTime()) > 90_000;

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

  const showRetry = report.analysisStage === 'preview' && (report.status === 'error' || report.processingPhase === 'error');
  const showLivePreview = report.analysisStage === 'preview' || !full;

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-50 border-b border-mason-gray-100 bg-white">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-6">
          <BrandLogo />
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

        {showLivePreview ? (
          <>
            <div className="mb-6 rounded-2xl border border-mason-gray-100 bg-mason-gray-50 px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-mason-gray-400">
                    Live Preview
                  </p>
                  <p className="mt-2 text-sm text-mason-black">
                    {slowContract
                      ? 'Still working through a large or scanned contract. Mason will reveal sections as they are ready.'
                      : processingCopy(report)}
                  </p>
                </div>

                {showRetry ? (
                  <button
                    type="button"
                    onClick={handleRetryPreview}
                    disabled={startingPreview}
                    className="rounded-xl border border-mason-black px-4 py-2 text-sm font-semibold text-mason-black disabled:opacity-60"
                  >
                    {startingPreview ? 'Retrying...' : 'Retry Preview'}
                  </button>
                ) : null}
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-5">
                {PREVIEW_STEPS.map((step, index) => {
                  const complete = currentStepIndex >= 0 && index < currentStepIndex;
                  const active = report.processingPhase === step.phase;

                  return (
                    <div
                      key={step.phase}
                      className={`rounded-xl px-3 py-3 text-xs font-medium ${
                        active
                          ? 'bg-white text-mason-black ring-1 ring-mason-black'
                          : complete
                            ? 'bg-white text-mason-black'
                            : 'bg-white/60 text-mason-gray-400'
                      }`}
                    >
                      {step.label}
                    </div>
                  );
                })}
              </div>

              {report.processingError ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {report.processingError}
                </div>
              ) : null}
            </div>

            <div className="mb-8">
              <p className="text-xs font-semibold uppercase tracking-[0.32em] text-mason-gray-400">
                Contract Risk Review
              </p>
              <h1 className="mt-4 font-kanit text-4xl font-black text-mason-black">
                {preview?.contract_details?.contract_type || 'Contract preview'}
              </h1>
              {preview?.executive_summary ? (
                <p className="mt-4 max-w-3xl text-base leading-relaxed text-mason-gray-600">
                  {preview.executive_summary}
                </p>
              ) : (
                <div className="mt-4 space-y-3">
                  <SkeletonBlock className="h-4 w-full" />
                  <SkeletonBlock className="h-4 w-11/12" />
                  <SkeletonBlock className="h-4 w-3/4" />
                </div>
              )}
            </div>

            <div className="mb-8 grid gap-4 md:grid-cols-2">
              {[
                { label: 'Parties', value: preview?.contract_details?.parties ?? 'Reading document...' },
                { label: 'Contract value', value: preview?.contract_details?.contract_value ?? 'Reading document...' },
                { label: 'Contract type', value: report.contractType === 'subcontract' ? 'Subcontract' : 'Head contract' },
                { label: 'Jurisdiction', value: jurisdictionLabel(report.jurisdiction) },
                { label: 'Key dates', value: preview?.contract_details?.key_dates ?? 'Reading document...' },
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
                  { label: 'HIGH', count: preview?.risk_count?.high ?? 0, tone: 'text-red-600' },
                  { label: 'MEDIUM', count: preview?.risk_count?.medium ?? 0, tone: 'text-amber-600' },
                  { label: 'LOW', count: preview?.risk_count?.low ?? 0, tone: 'text-green-600' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl bg-mason-gray-50 px-4 py-4 text-center">
                    <p className={`font-kanit text-3xl font-black ${item.tone}`}>{item.count}</p>
                    <p className={`text-xs font-semibold ${item.tone}`}>{item.label}</p>
                  </div>
                ))}
              </div>
            </div>

            {preview?.preview_risk ? (
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
            ) : (
              <div className="mb-10 rounded-3xl border border-mason-gray-100 bg-mason-gray-50 p-8">
                <div className="mb-4 h-3 w-40 animate-pulse rounded-full bg-mason-gray-200" />
                <div className="mb-3 h-6 w-2/3 animate-pulse rounded-full bg-mason-gray-200" />
                <div className="mb-3 h-4 w-full animate-pulse rounded-full bg-mason-gray-200" />
                <div className="h-4 w-5/6 animate-pulse rounded-full bg-mason-gray-200" />
              </div>
            )}
          </>
        ) : null}

        {report.status === 'error' && !showRetry ? (
          <div className="mb-10 rounded-3xl border border-red-200 bg-red-50 p-8 text-center">
            <p className="text-lg font-semibold text-mason-black">Analysis failed</p>
            <p className="mt-3 text-sm leading-relaxed text-mason-gray-600">
              {report.processingError || report.errorMessage || 'Something went wrong while analysing your documents.'}
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

        {report.paid && !full ? (
          <div className="rounded-3xl border border-mason-gray-100 bg-mason-gray-50 p-8 text-center">
            <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-mason-black border-t-transparent" />
            <p className="text-lg font-semibold text-mason-black">Building your full report</p>
            <p className="mt-2 text-sm text-mason-gray-500">
              {report.processingMessage || `Generating your full report against ${jurisdictionLabel(report.jurisdiction)}.`}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
