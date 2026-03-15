'use client';

import { useState, useCallback, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';

// ── Types ──────────────────────────────────────────────────────────────────
interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
}

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  companyName: string;
  phone: string;
  website: string;
  contractType: 'subcontract' | 'head_contract';
}

type Phase = 'upload' | 'form' | 'processing';

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

const FILE_ICONS: Record<string, string> = {
  pdf:  '📄',
  png:  '🖼️', jpg: '🖼️', jpeg: '🖼️', webp: '🖼️', heic: '🖼️',
  docx: '📝', doc: '📝',
  xlsx: '📊', xls: '📊', csv: '📊',
};

function fileExt(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function fileIcon(name: string) {
  return FILE_ICONS[fileExt(name)] ?? '📄';
}

function formatBytes(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(0) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}

// ── Landing Page ───────────────────────────────────────────────────────────
export default function LandingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase]       = useState<Phase>('upload');
  const [files, setFiles]       = useState<UploadFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError]       = useState('');
  const [processingMsg, setProcessingMsg] = useState('');

  const [form, setForm] = useState<FormData>({
    firstName: '', lastName: '', email: '', password: '',
    companyName: '', phone: '', website: '',
    contractType: 'subcontract',
  });

  // ── File handling ────────────────────────────────────────────────────────
  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(f => {
      const ext = fileExt(f.name);
      return ACCEPTED_TYPES.includes(f.type) ||
        ['pdf','png','jpg','jpeg','webp','heic','docx','doc','xlsx','xls','csv'].includes(ext);
    });
    if (valid.length === 0) {
      setError('Please upload PDF, Word, Excel, PNG or JPG files.');
      return;
    }
    const items: UploadFile[] = valid.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      progress: 0,
      status: 'waiting',
    }));
    setFiles(prev => [...prev, ...items]);
    setError('');
    setPhase('form');
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.files);
    addFiles(items);
  }, [addFiles]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const items = Array.from(e.target.files ?? []);
    addFiles(items);
    e.target.value = '';
  }, [addFiles]);

  const removeFile = (id: string) => {
    setFiles(prev => {
      const next = prev.filter(f => f.id !== id);
      if (next.length === 0) setPhase('upload');
      return next;
    });
  };

  // ── Upload a single file to R2 via presigned URL ─────────────────────────
  async function uploadFile(item: UploadFile, reportId: string): Promise<string> {
    // 1. Get presigned URL
    const urlRes = await fetch('/api/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reportId,
        filename: item.file.name,
        contentType: item.file.type || 'application/octet-stream',
        size: item.file.size,
      }),
    });
    if (!urlRes.ok) throw new Error('Failed to get upload URL');
    const { presignedUrl, r2Key } = await urlRes.json();

    // 2. Upload directly to R2 with progress tracking
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const pct = Math.round((e.loaded / e.total) * 100);
          setFiles(prev => prev.map(f =>
            f.id === item.id ? { ...f, progress: pct, status: 'uploading' } : f
          ));
        }
      });
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setFiles(prev => prev.map(f =>
            f.id === item.id ? { ...f, progress: 100, status: 'done' } : f
          ));
          resolve();
        } else {
          reject(new Error('Upload failed'));
        }
      });
      xhr.addEventListener('error', () => reject(new Error('Upload error')));
      xhr.open('PUT', presignedUrl);
      xhr.setRequestHeader('Content-Type', item.file.type || 'application/octet-stream');
      xhr.send(item.file);
    });

    return r2Key;
  }

  // ── Submit handler ────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) { setError('Please upload at least one document.'); return; }
    setPhase('processing');
    setError('');

    try {
      setProcessingMsg('Creating your account...');

      // 1. Create report + user account
      const createRes = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName:    form.firstName,
          lastName:     form.lastName,
          email:        form.email,
          password:     form.password,
          companyName:  form.companyName,
          phone:        form.phone,
          website:      form.website,
          contractType: form.contractType,
          fileCount:    files.length,
        }),
      });

      if (!createRes.ok) {
        const err = await createRes.json();
        throw new Error(err.error || 'Failed to create account');
      }

      const { reportId } = await createRes.json();

      // 2. Upload all files directly to R2
      setProcessingMsg(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
      const r2Keys: string[] = [];

      for (const item of files) {
        setFiles(prev => prev.map(f =>
          f.id === item.id ? { ...f, status: 'uploading' } : f
        ));
        const key = await uploadFile(item, reportId);
        r2Keys.push(key);
      }

      // 3. Trigger AI analysis
      setProcessingMsg('Running contract analysis...');
      await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId, r2Keys, contractType: form.contractType }),
      });

      // 4. Navigate to report
      router.push(`/report/${reportId}`);

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Something went wrong';
      setError(msg);
      setPhase('form');
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-white">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white border-b border-mason-gray-100">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Image src="/logo.png" alt="Mason" width={120} height={32} className="h-7 w-auto" priority />
          <div className="flex items-center gap-6">
            <span className="text-sm text-mason-gray-500 font-inter">
              Free first risk · Full report from $799
            </span>
            <a href="#how" className="text-sm font-medium text-mason-gray-700 hover:text-black transition-colors hidden sm:block">
              How it works
            </a>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="pt-28 pb-12 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold tracking-widest text-mason-gray-400 uppercase mb-5 font-inter">
            AI Contract Analysis · Australian Construction Law
          </p>
          <h1
            className="font-kanit font-black text-5xl md:text-6xl lg:text-7xl text-mason-black leading-none tracking-tight mb-5"
            style={{ fontFamily: 'Kanit, sans-serif', fontWeight: 900 }}
          >
            Know Every Risk<br />Before You Sign.
          </h1>
          <p className="text-lg md:text-xl text-mason-gray-500 font-inter leading-relaxed max-w-2xl mx-auto mb-10">
            Upload your subcontract or head contract. Mason's AI analyses every clause,
            identifies HIGH, MEDIUM, and LOW risk items, and tells you exactly what to
            negotiate — before you're locked in.
          </p>

          {/* Trust badges */}
          <div className="flex flex-wrap items-center justify-center gap-4 mb-10 text-sm text-mason-gray-500 font-inter">
            {['AS4000 · AS2124 · AS2545', 'SOPA — All Australian states', 'Bank-grade encryption', 'Results in 60 seconds'].map(b => (
              <span key={b} className="flex items-center gap-2 bg-mason-gray-50 px-3 py-1.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-mason-gray-300" />
                {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Main upload / form area ─────────────────────────────────────────── */}
      <section className="pb-20 px-6">
        <div className="max-w-2xl mx-auto">

          {/* ── Phase: UPLOAD ────────────────────────────────────────────────── */}
          {phase === 'upload' && (
            <div
              className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200 ${
                dragOver ? 'drop-active border-black bg-mason-gray-50' : 'border-mason-gray-200 hover:border-mason-gray-400 hover:bg-mason-gray-50'
              }`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div className="mb-4 text-5xl">📂</div>
              <p className="font-kanit font-bold text-xl text-mason-black mb-2" style={{ fontFamily: 'Kanit, sans-serif' }}>
                Drop your contract documents here
              </p>
              <p className="text-mason-gray-500 text-sm font-inter mb-6">
                or click to browse — folders, PDFs, Word, Excel, images accepted
              </p>
              <div className="inline-flex items-center gap-2 bg-mason-black text-white px-6 py-3 rounded-xl text-sm font-semibold font-inter hover:bg-mason-gray-800 transition-colors">
                Choose Files
              </div>
              <p className="mt-4 text-xs text-mason-gray-400 font-inter">
                PDF · PNG · JPG · DOCX · XLSX · Up to 1 GB total
              </p>
            </div>
          )}

          {/* ── Phase: FORM ──────────────────────────────────────────────────── */}
          {(phase === 'form' || phase === 'processing') && (
            <div className="slide-in">

              {/* File list */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm font-semibold text-mason-black font-inter">
                    {files.length} file{files.length !== 1 ? 's' : ''} selected
                  </span>
                  {phase === 'form' && (
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      className="text-sm text-mason-gray-500 hover:text-black font-inter underline"
                    >
                      + Add more
                    </button>
                  )}
                </div>

                <div className="space-y-2">
                  {files.map(f => (
                    <div key={f.id} className="flex items-center gap-3 bg-mason-gray-50 rounded-xl px-4 py-3">
                      <span className="text-lg">{fileIcon(f.file.name)}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-mason-black font-inter truncate">{f.file.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <p className="text-xs text-mason-gray-400 font-inter">{formatBytes(f.file.size)}</p>
                          {f.status === 'uploading' && (
                            <>
                              <div className="flex-1 bg-mason-gray-200 rounded-full h-1">
                                <div
                                  className="progress-bar bg-mason-black h-1 rounded-full"
                                  style={{ width: `${f.progress}%` }}
                                />
                              </div>
                              <span className="text-xs text-mason-gray-400 font-inter">{f.progress}%</span>
                            </>
                          )}
                          {f.status === 'done' && <span className="text-xs text-green-600 font-inter">✓ Uploaded</span>}
                          {f.status === 'error' && <span className="text-xs text-red-600 font-inter">✕ Failed</span>}
                        </div>
                      </div>
                      {phase === 'form' && (
                        <button
                          onClick={() => removeFile(f.id)}
                          className="text-mason-gray-300 hover:text-mason-gray-600 text-lg leading-none"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Registration form */}
              {phase === 'form' && (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="border-t border-mason-gray-100 pt-6">
                    <p className="text-sm font-semibold text-mason-black font-inter mb-4">Your details</p>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">First name</label>
                        <input
                          required
                          type="text"
                          value={form.firstName}
                          onChange={e => setForm(p => ({ ...p, firstName: e.target.value }))}
                          className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                          placeholder="David"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">Last name</label>
                        <input
                          required
                          type="text"
                          value={form.lastName}
                          onChange={e => setForm(p => ({ ...p, lastName: e.target.value }))}
                          className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                          placeholder="Lynch"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">Email</label>
                      <input
                        required
                        type="email"
                        value={form.email}
                        onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                        className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                        placeholder="david@dncprojects.com.au"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">Password</label>
                      <input
                        required
                        type="password"
                        minLength={8}
                        value={form.password}
                        onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                        className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                        placeholder="At least 8 characters"
                      />
                    </div>

                    <div className="mt-4">
                      <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">Company name</label>
                      <input
                        required
                        type="text"
                        value={form.companyName}
                        onChange={e => setForm(p => ({ ...p, companyName: e.target.value }))}
                        className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                        placeholder="DNC Projects Pty Ltd"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4">
                      <div>
                        <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">
                          Phone <span className="text-mason-gray-300">(optional)</span>
                        </label>
                        <input
                          type="tel"
                          value={form.phone}
                          onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                          className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                          placeholder="0412 345 678"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-mason-gray-500 font-inter mb-1.5">
                          Website <span className="text-mason-gray-300">(optional)</span>
                        </label>
                        <input
                          type="url"
                          value={form.website}
                          onChange={e => setForm(p => ({ ...p, website: e.target.value }))}
                          className="w-full border border-mason-gray-200 rounded-xl px-4 py-3 text-sm font-inter text-mason-black placeholder-mason-gray-300 transition-colors"
                          placeholder="https://dncprojects.com.au"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contract type */}
                  <div className="border-t border-mason-gray-100 pt-5">
                    <p className="text-sm font-semibold text-mason-black font-inter mb-3">
                      Which type of contract is this?
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { value: 'subcontract',   label: 'Subcontract', sub: 'You are the subcontractor' },
                        { value: 'head_contract', label: 'Head contract', sub: 'You are the main contractor' },
                      ].map(opt => (
                        <label
                          key={opt.value}
                          className={`flex flex-col gap-1 border-2 rounded-xl px-4 py-4 cursor-pointer transition-all ${
                            form.contractType === opt.value
                              ? 'border-mason-black bg-mason-gray-50'
                              : 'border-mason-gray-200 hover:border-mason-gray-300'
                          }`}
                        >
                          <input
                            type="radio"
                            name="contractType"
                            value={opt.value}
                            checked={form.contractType === opt.value}
                            onChange={() => setForm(p => ({ ...p, contractType: opt.value as 'subcontract' | 'head_contract' }))}
                            className="sr-only"
                          />
                          <span className="text-sm font-semibold text-mason-black font-inter">{opt.label}</span>
                          <span className="text-xs text-mason-gray-400 font-inter">{opt.sub}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 font-inter">
                      {error}
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    type="submit"
                    className="w-full bg-mason-black text-white font-semibold font-inter py-4 rounded-xl text-base hover:bg-mason-gray-800 transition-colors flex items-center justify-center gap-2"
                  >
                    Analyse My Contract
                    <span>→</span>
                  </button>

                  <p className="text-center text-xs text-mason-gray-400 font-inter">
                    Free first risk identified. Full report $799 AUD. Your documents are encrypted and never shared.
                  </p>
                </form>
              )}

              {/* Processing state */}
              {phase === 'processing' && (
                <div className="text-center py-8 slide-in">
                  <div className="inline-flex items-center gap-3 mb-6">
                    <div className="w-5 h-5 border-2 border-mason-black border-t-transparent rounded-full animate-spin" />
                    <span className="text-sm font-medium text-mason-black font-inter">{processingMsg}</span>
                  </div>
                  <div className="text-xs text-mason-gray-400 font-inter">
                    This usually takes 30–60 seconds.
                  </div>
                </div>
              )}
            </div>
          )}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.docx,.doc,.xlsx,.xls,.csv"
            className="sr-only"
            onChange={onFileInput}
          />
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how" className="border-t border-mason-gray-100 py-20 px-6 bg-mason-gray-50">
        <div className="max-w-4xl mx-auto">
          <p className="text-xs font-semibold tracking-widest text-mason-gray-400 uppercase mb-4 font-inter text-center">How it works</p>
          <h2 className="font-kanit font-black text-3xl md:text-4xl text-mason-black mb-12 text-center" style={{ fontFamily: 'Kanit, sans-serif' }}>
            Contract clarity in 60 seconds.
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              { n: '01', title: 'Upload your contract', body: 'Drag and drop your subcontract, annexures, schedules, and drawings. PDF, Word, Excel, and images all supported. Up to 1 GB.' },
              { n: '02', title: 'AI reads every clause', body: 'Mason analyses the full document against Australian construction law — AS4000, AS2124, SOPA — and identifies every risk item.' },
              { n: '03', title: 'Know before you sign', body: 'Get a structured risk register with HIGH, MEDIUM, and LOW items. See the first risk free. Unlock the full report for $799.' },
            ].map(s => (
              <div key={s.n} className="bg-white rounded-2xl p-6 border border-mason-gray-100">
                <p className="font-kanit font-black text-4xl text-mason-gray-100 mb-3" style={{ fontFamily: 'Kanit, sans-serif' }}>{s.n}</p>
                <p className="font-semibold text-mason-black font-inter mb-2">{s.title}</p>
                <p className="text-sm text-mason-gray-500 font-inter leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ────────────────────────────────────────────────────────── */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="text-xs font-semibold tracking-widest text-mason-gray-400 uppercase mb-4 font-inter">Pricing</p>
          <h2 className="font-kanit font-black text-3xl md:text-4xl text-mason-black mb-12" style={{ fontFamily: 'Kanit, sans-serif' }}>
            One price. One contract. No subscription.
          </h2>
          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto text-left">
            <div className="border border-mason-gray-100 rounded-2xl p-6">
              <p className="font-semibold text-mason-black font-inter mb-1">Free preview</p>
              <p className="text-3xl font-kanit font-black text-mason-black mb-4" style={{ fontFamily: 'Kanit, sans-serif' }}>$0</p>
              <ul className="space-y-2 text-sm text-mason-gray-600 font-inter">
                {['Executive summary', 'Total risk count (HIGH / MED / LOW)', 'First HIGH risk — full detail + recommendation'].map(i => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>{i}
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-2 border-mason-black rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-4 right-4 bg-mason-black text-white text-xs font-semibold px-2 py-1 rounded-full font-inter">Most popular</div>
              <p className="font-semibold text-mason-black font-inter mb-1">Full report</p>
              <p className="text-3xl font-kanit font-black text-mason-black mb-4" style={{ fontFamily: 'Kanit, sans-serif' }}>$799 <span className="text-base font-inter font-normal text-mason-gray-400">AUD</span></p>
              <ul className="space-y-2 text-sm text-mason-gray-600 font-inter">
                {[
                  'Everything in free preview',
                  'All HIGH, MEDIUM, and LOW risks',
                  'Every clause reference and recommendation',
                  'Financial terms summary',
                  'Immediate action plan before signing',
                  'Download as PDF',
                ].map(i => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-green-600 mt-0.5">✓</span>{i}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-mason-gray-100 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <Image src="/logo.png" alt="Mason" width={80} height={22} className="h-5 w-auto opacity-60" />
          <p className="text-xs text-mason-gray-400 font-inter text-center">
            © 2026 Mason. gomason.ai · Not legal advice — always consult a construction lawyer.
          </p>
          <div className="flex gap-4 text-xs text-mason-gray-400 font-inter">
            <a href="/privacy" className="hover:text-mason-gray-600">Privacy</a>
            <a href="/terms" className="hover:text-mason-gray-600">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
