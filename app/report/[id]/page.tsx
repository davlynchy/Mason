'use client';

import { useState, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────
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
  contractType: 'subcontract' | 'head_contract';
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

// ── Helpers ────────────────────────────────────────────────────────────────
const LEVEL_STYLES = {
  HIGH:   { badge: 'badge-high',   dot: 'bg-risk-high',   label: 'HIGH' },
  MEDIUM: { badge: 'badge-medium', dot: 'bg-risk-medium', label: 'MEDIUM' },
  LOW:    { badge: 'badge-low',    dot: 'bg-risk-low',    label: 'LOW' },
};

function RiskBadge({ level }: { level: Risk['level'] }) {
  const s = LEVEL_STYLES[level];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full font-inter ${s.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function RiskCard({ risk, blurred = false }: { risk: Risk; blurred?: boolean }) {
  const [open, setOpen] = useState(!blurred);
  return (
    <div className={`border border-mason-gray-100 rounded-2xl overflow-hidden ${blurred ? 'blur-paywall select-none' : ''}`}>
      <button
        onClick={() => !blurred && setOpen(o => !o)}
        className="w-full flex items-start gap-4 px-5 py-4 text-left hover:bg-mason-gray-50 transition-colors"
      >
        <span className="text-sm font-semibold text-mason-gray-300 font-inter w-8 pt-0.5">{risk.id}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <RiskBadge level={risk.level} />
            {risk.clause && (
              <span className="text-xs text-mason-gray-400 font-inter">{risk.clause}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-mason-black font-inter">{risk.title}</p>
          <p className="text-xs text-mason-gray-500 font-inter mt-0.5 line-clamp-2">{risk.impact}</p>
        </div>
        {!blurred && (
          <span className="text-mason-gray-300 text-sm mt-0.5">{open ? '↑' : '↓'}</span>
        )}
      </button>

      {open && !blurred && (
        <div className="px-5 pb-5 border-t border-mason-gray-50">
          <div className="pt-4 space-y-4">
            <div>
              <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-1.5">Detail</p>
              <p className="text-sm text-mason-gray-700 font-inter leading-relaxed">{risk.detail}</p>
            </div>
            <div className="bg-mason-gray-50 rounded-xl px-4 py-3">
              <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-1.5">Recommended action</p>
              <p className="text-sm text-mason-black font-inter leading-relaxed">{risk.recommendation}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Report Page ────────────────────────────────────────────────────────────
export default function ReportPage() {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState(false);

  // Poll for report status
  const fetchReport = useCallback(async () => {
    try {
      const res = await fetch(`/api/reports/${id}`);
      if (!res.ok) return;
      const data: ReportData = await res.json();
      setReport(data);
      setLoading(false);
      return data;
    } catch {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchReport();
    // Poll every 3 seconds while processing
    const interval = setInterval(async () => {
      const data = await fetchReport();
      if (data && (data.status === 'complete' || data.status === 'error')) {
        clearInterval(interval);
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchReport]);

  // Stripe checkout
  const handleUpgrade = async () => {
    setPaying(true);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: id }),
      });
      const { url } = await res.json();
      if (url) window.location.href = url;
    } catch {
      setPaying(false);
    }
  };

  // ── States ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-mason-black border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-mason-gray-500 font-inter">Loading your report...</p>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-semibold text-mason-black font-inter mb-2">Report not found</p>
          <a href="/" className="text-sm text-mason-gray-500 font-inter underline">Start a new review</a>
        </div>
      </div>
    );
  }

  const isProcessing = report.status === 'uploading' || report.status === 'processing';
  const isError      = report.status === 'error';
  const preview      = report.previewData;
  const full         = report.fullData;

  // ── Processing ─────────────────────────────────────────────────────────
  if (isProcessing) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <header className="border-b border-mason-gray-100 px-6 h-16 flex items-center">
          <Image src="/logo.png" alt="Mason" width={100} height={28} className="h-6 w-auto" />
        </header>
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          <div className="w-12 h-12 border-2 border-mason-black border-t-transparent rounded-full animate-spin" />
          <div className="text-center max-w-sm">
            <p className="font-semibold text-mason-black font-inter text-lg mb-2">Analysing your contract</p>
            <p className="text-sm text-mason-gray-500 font-inter leading-relaxed">
              Mason is reading every clause against Australian construction law.
              This takes about 60 seconds.
            </p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-mason-gray-400 font-inter text-center">
            <p>📄 Extracting document text...</p>
            <p>⚖️ Checking AS4000 · AS2124 · SOPA...</p>
            <p>🔍 Identifying risk items...</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-4 px-6">
        <p className="text-lg font-semibold text-mason-black font-inter">Analysis failed</p>
        <p className="text-sm text-mason-gray-500 font-inter max-w-sm text-center">
          {report.errorMessage || 'Something went wrong processing your documents. Please try again.'}
        </p>
        <a href="/" className="bg-mason-black text-white px-6 py-3 rounded-xl text-sm font-semibold font-inter hover:bg-mason-gray-800 transition-colors">
          Try again
        </a>
      </div>
    );
  }

  // ── Complete Report ─────────────────────────────────────────────────────
  const allRisks = full?.risks ?? [];
  const lockedRisks = allRisks.slice(1); // First risk already shown in preview
  const highCount   = preview?.risk_count.high   ?? 0;
  const medCount    = preview?.risk_count.medium  ?? 0;
  const lowCount    = preview?.risk_count.low     ?? 0;
  const totalRisks  = highCount + medCount + lowCount;

  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 bg-white border-b border-mason-gray-100">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Image src="/logo.png" alt="Mason" width={100} height={28} className="h-6 w-auto" />
          {!report.paid && (
            <button
              onClick={handleUpgrade}
              disabled={paying}
              className="bg-mason-black text-white text-sm font-semibold font-inter px-4 py-2 rounded-xl hover:bg-mason-gray-800 transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              {paying ? (
                <span className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />
              ) : null}
              Unlock Full Report — $799
            </button>
          )}
          {report.paid && (
            <span className="text-sm text-green-600 font-semibold font-inter flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              Full report unlocked
            </span>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">

        {/* ── Executive Summary ───────────────────────────────────────────── */}
        {preview && (
          <div className="mb-8 slide-in">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold tracking-widest text-mason-gray-400 uppercase font-inter">
                Contract Risk Review
              </span>
            </div>
            <h1 className="font-kanit font-black text-3xl md:text-4xl text-mason-black mb-4 leading-tight" style={{ fontFamily: 'Kanit, sans-serif' }}>
              {preview.contract_details.contract_type}
            </h1>
            <p className="text-mason-gray-600 font-inter leading-relaxed mb-6">
              {preview.executive_summary}
            </p>

            {/* Contract details */}
            <div className="grid sm:grid-cols-2 gap-4 mb-6">
              {[
                { label: 'Parties', value: preview.contract_details.parties },
                { label: 'Contract value', value: preview.contract_details.contract_value ?? 'Not specified' },
                { label: 'Contract type', value: report.contractType === 'subcontract' ? 'Subcontract' : 'Head contract' },
                { label: 'Key dates', value: preview.contract_details.key_dates },
              ].map(item => (
                <div key={item.label} className="bg-mason-gray-50 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-1">{item.label}</p>
                  <p className="text-sm text-mason-black font-inter">{item.value}</p>
                </div>
              ))}
            </div>

            {/* Risk count summary */}
            <div className="border border-mason-gray-100 rounded-2xl p-5">
              <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-3">
                Risk summary — {totalRisks} items identified
              </p>
              <div className="grid grid-cols-3 gap-4">
                {[
                  { level: 'HIGH',   count: highCount,  color: 'text-risk-high',   bg: 'bg-red-50' },
                  { level: 'MEDIUM', count: medCount,   color: 'text-risk-medium', bg: 'bg-amber-50' },
                  { level: 'LOW',    count: lowCount,   color: 'text-risk-low',    bg: 'bg-green-50' },
                ].map(r => (
                  <div key={r.level} className={`${r.bg} rounded-xl px-4 py-3 text-center`}>
                    <p className={`text-2xl font-kanit font-black ${r.color}`} style={{ fontFamily: 'Kanit, sans-serif' }}>{r.count}</p>
                    <p className={`text-xs font-semibold ${r.color} font-inter`}>{r.level}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Risk Register ────────────────────────────────────────────────── */}
        <div className="mb-8">
          <h2 className="font-kanit font-black text-xl text-mason-black mb-4" style={{ fontFamily: 'Kanit, sans-serif' }}>
            Risk Register
          </h2>

          <div className="space-y-3">

            {/* First risk — always visible free */}
            {preview?.preview_risk && (
              <RiskCard risk={preview.preview_risk} blurred={false} />
            )}

            {/* Paid: show all remaining risks */}
            {report.paid && lockedRisks.map(risk => (
              <RiskCard key={risk.id} risk={risk} blurred={false} />
            ))}

            {/* Not paid: blurred placeholder risks + paywall */}
            {!report.paid && totalRisks > 1 && (
              <div className="relative">
                {/* Blurred placeholder cards */}
                <div className="space-y-3 pointer-events-none">
                  {Array.from({ length: Math.min(totalRisks - 1, 4) }).map((_, i) => (
                    <div key={i} className="blur-paywall">
                      <RiskCard
                        blurred={true}
                        risk={{
                          id: `R0${i + 2}`,
                          level: i % 3 === 0 ? 'HIGH' : i % 3 === 1 ? 'MEDIUM' : 'LOW',
                          title: 'Risk item hidden until full report unlocked',
                          clause: 'Clause X.X',
                          impact: 'This risk has significant financial and commercial implications that require your attention before signing.',
                          detail: 'Detailed analysis of this risk is available in the full report.',
                          recommendation: 'Specific negotiation strategy and recommended action to protect your position.',
                        }}
                      />
                    </div>
                  ))}
                </div>

                {/* Paywall overlay */}
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-b from-white/20 to-white/95">
                  <div className="text-center bg-white border border-mason-gray-100 rounded-2xl shadow-lg p-8 mx-4 max-w-sm">
                    <div className="text-4xl mb-3">🔒</div>
                    <h3 className="font-kanit font-black text-xl text-mason-black mb-2" style={{ fontFamily: 'Kanit, sans-serif' }}>
                      {totalRisks - 1} more risk{totalRisks - 1 !== 1 ? 's' : ''} identified
                    </h3>
                    <p className="text-sm text-mason-gray-500 font-inter mb-5 leading-relaxed">
                      Unlock the complete risk register, financial summary, and your action plan before signing.
                    </p>
                    <button
                      onClick={handleUpgrade}
                      disabled={paying}
                      className="w-full bg-mason-black text-white font-semibold font-inter py-3.5 rounded-xl text-sm hover:bg-mason-gray-800 transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                      {paying && <span className="w-4 h-4 border border-white border-t-transparent rounded-full animate-spin" />}
                      Unlock Full Report — $799
                    </button>
                    <p className="text-xs text-mason-gray-400 font-inter mt-3">
                      One-time payment · Instant access · Secure checkout
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Financial Summary (paid only) ─────────────────────────────────── */}
        {report.paid && full?.financial_summary && (
          <div className="mb-8">
            <h2 className="font-kanit font-black text-xl text-mason-black mb-4" style={{ fontFamily: 'Kanit, sans-serif' }}>
              Financial Summary
            </h2>
            <div className="border border-mason-gray-100 rounded-2xl p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                {[
                  { label: 'Contract sum', value: full.financial_summary.contract_sum ?? 'Not specified' },
                  { label: 'Payment terms', value: full.financial_summary.payment_terms },
                  { label: 'Liquidated damages', value: full.financial_summary.liquidated_damages ?? 'None stated' },
                  { label: 'Retention', value: full.financial_summary.retention ?? 'None stated' },
                ].map(item => (
                  <div key={item.label}>
                    <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-1">{item.label}</p>
                    <p className="text-sm text-mason-black font-inter">{item.value}</p>
                  </div>
                ))}
              </div>
              {full.financial_summary.key_financial_risks.length > 0 && (
                <div className="border-t border-mason-gray-100 pt-4">
                  <p className="text-xs font-semibold text-mason-gray-400 uppercase tracking-wide font-inter mb-2">Key financial risks</p>
                  <ul className="space-y-1">
                    {full.financial_summary.key_financial_risks.map((r, i) => (
                      <li key={i} className="text-sm text-mason-gray-700 font-inter flex items-start gap-2">
                        <span className="text-risk-high mt-0.5">!</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Immediate Actions (paid only) ─────────────────────────────────── */}
        {report.paid && full?.immediate_actions && full.immediate_actions.length > 0 && (
          <div className="mb-10">
            <h2 className="font-kanit font-black text-xl text-mason-black mb-4" style={{ fontFamily: 'Kanit, sans-serif' }}>
              Before You Sign — Action Plan
            </h2>
            <div className="border-2 border-mason-black rounded-2xl p-5">
              <ul className="space-y-3">
                {full.immediate_actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <span className="font-kanit font-black text-lg text-mason-gray-200 leading-none pt-0.5 min-w-[28px]" style={{ fontFamily: 'Kanit, sans-serif' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <p className="text-sm text-mason-black font-inter leading-relaxed">{action}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* ── Footer disclaimer ─────────────────────────────────────────────── */}
        <div className="border-t border-mason-gray-100 pt-6">
          <p className="text-xs text-mason-gray-400 font-inter leading-relaxed text-center">
            This review is generated by AI and is for informational purposes only.
            It does not constitute legal advice. Always consult a qualified construction
            lawyer before executing any contract. Mason © 2026 · gomason.ai
          </p>
        </div>
      </div>
    </div>
  );
}
