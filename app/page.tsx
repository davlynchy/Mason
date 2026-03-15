'use client';

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type PageMode = 'signup' | 'login';
type Phase = 'upload' | 'form' | 'processing';
type ContractType = 'subcontract' | 'head_contract';
type Jurisdiction = 'AU' | 'UK' | 'USA';

interface UploadFile {
  id: string;
  file: File;
  progress: number;
  status: 'waiting' | 'uploading' | 'done' | 'error';
}

interface SignupFormData {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  companyName: string;
  phone: string;
  website: string;
  contractType: ContractType;
  jurisdiction: Jurisdiction;
}

interface LoginFormData {
  email: string;
  password: string;
}

const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
];

const FILE_ICONS: Record<string, string> = {
  pdf: 'PDF',
  png: 'IMG',
  jpg: 'IMG',
  jpeg: 'IMG',
  webp: 'IMG',
  heic: 'IMG',
  docx: 'DOC',
  doc: 'DOC',
  xlsx: 'XLS',
  xls: 'XLS',
  csv: 'CSV',
};

const JURISDICTIONS: Array<{
  value: Jurisdiction;
  label: string;
  sublabel: string;
  loadingLabel: string;
}> = [
  {
    value: 'AU',
    label: 'Australia',
    sublabel: 'Security of Payment and standard form contracts',
    loadingLabel: 'Scanning against Australian construction law...',
  },
  {
    value: 'UK',
    label: 'United Kingdom',
    sublabel: 'JCT, NEC, HGCRA, adjudication and payment notices',
    loadingLabel: 'Scanning against UK construction law...',
  },
  {
    value: 'USA',
    label: 'United States',
    sublabel: 'AIA, lien rights, prompt payment and indemnity risk',
    loadingLabel: 'Scanning against US construction law...',
  },
];

function fileExt(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function fileIcon(name: string) {
  return FILE_ICONS[fileExt(name)] ?? 'FILE';
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function LandingPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<PageMode>('signup');
  const [phase, setPhase] = useState<Phase>('upload');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [processingMsg, setProcessingMsg] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupForm, setSignupForm] = useState<SignupFormData>({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    companyName: '',
    phone: '',
    website: '',
    contractType: 'subcontract',
    jurisdiction: 'AU',
  });

  const [loginForm, setLoginForm] = useState<LoginFormData>({
    email: '',
    password: '',
  });

  const addFiles = useCallback((incoming: File[]) => {
    const valid = incoming.filter(file => {
      const ext = fileExt(file.name);
      return ACCEPTED_TYPES.includes(file.type) ||
        ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'heic', 'docx', 'doc', 'xlsx', 'xls', 'csv'].includes(ext);
    });

    if (valid.length === 0) {
      setError('Please upload a PDF, Word, Excel, or image file.');
      return;
    }

    const items = valid.map(file => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: 'waiting' as const,
    }));

    setFiles(prev => [...prev, ...items]);
    setError('');
    setMode('signup');
    setPhase('form');
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const onFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    addFiles(Array.from(e.target.files ?? []));
    e.target.value = '';
  }, [addFiles]);

  const removeFile = (id: string) => {
    setFiles(prev => {
      const next = prev.filter(file => file.id !== id);
      if (next.length === 0) {
        setPhase('upload');
      }
      return next;
    });
  };

  async function uploadFile(item: UploadFile, reportId: string): Promise<string> {
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

    if (!urlRes.ok) {
      throw new Error('Failed to get upload URL');
    }

    const { presignedUrl, r2Key } = await urlRes.json();

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', event => {
        if (!event.lengthComputable) return;
        const pct = Math.round((event.loaded / event.total) * 100);
        setFiles(prev => prev.map(file =>
          file.id === item.id ? { ...file, progress: pct, status: 'uploading' } : file
        ));
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          setFiles(prev => prev.map(file =>
            file.id === item.id ? { ...file, progress: 100, status: 'done' } : file
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

  async function handleSignupSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (files.length === 0) {
      setError('Please upload at least one document.');
      return;
    }

    setPhase('processing');
    setError('');

    try {
      setProcessingMsg('Creating your account...');

      const createRes = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          firstName: signupForm.firstName,
          lastName: signupForm.lastName,
          email: signupForm.email,
          password: signupForm.password,
          companyName: signupForm.companyName,
          phone: signupForm.phone,
          website: signupForm.website,
          contractType: signupForm.contractType,
          jurisdiction: signupForm.jurisdiction,
          fileCount: files.length,
        }),
      });

      const createData = await createRes.json().catch(() => null);
      if (!createRes.ok) {
        throw new Error(createData?.error || 'Failed to create account');
      }

      const { reportId } = createData;

      setProcessingMsg(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`);
      const r2Keys: string[] = [];
      for (const item of files) {
        setFiles(prev => prev.map(file =>
          file.id === item.id ? { ...file, status: 'uploading' } : file
        ));
        const key = await uploadFile(item, reportId);
        r2Keys.push(key);
      }

      const jurisdictionConfig = JURISDICTIONS.find(item => item.value === signupForm.jurisdiction);
      setProcessingMsg(jurisdictionConfig?.loadingLabel ?? 'Generating your preview...');

      router.push(`/report/${reportId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setPhase('form');
    }
  }

  async function handleLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoginLoading(true);

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(loginForm),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error || 'Login failed');
      }

      router.push(`/report/${data.reportId}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoginLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-white">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-mason-gray-100 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <img src="/logo.svg?v=3" alt="Mason" className="h-8 w-auto" />
          <div className="flex items-center gap-6">
            <span className="hidden text-sm text-mason-gray-500 sm:block">
              Free first risk · Full report from $799
            </span>
            <a href="#how" className="hidden text-sm font-medium text-mason-gray-700 hover:text-black sm:block">
              How it works
            </a>
          </div>
        </div>
      </header>

      <section className="px-6 pb-10 pt-28">
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.32em] text-mason-gray-400">
            AI Contract Analysis · Construction Law
          </p>
          <h1 className="mb-5 font-kanit text-5xl font-black leading-none tracking-tight text-mason-black md:text-6xl lg:text-7xl">
            Know Every Risk
            <br />
            Before You Sign.
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-mason-gray-500 md:text-xl">
            Upload your contract, pick the jurisdiction, and get a fast risk preview first.
            Full analysis unlocks after payment so returning customers do not wait on a giant upfront run.
          </p>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto max-w-2xl">
          <div className="mb-6 inline-flex rounded-2xl border border-mason-gray-100 bg-mason-gray-50 p-1">
            {[
              { value: 'signup', label: 'New Review' },
              { value: 'login', label: 'Returning Customer' },
            ].map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  setMode(option.value as PageMode);
                  setError('');
                }}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  mode === option.value
                    ? 'bg-white text-mason-black shadow-sm'
                    : 'text-mason-gray-500 hover:text-mason-black'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === 'login' ? (
            <div className="rounded-3xl border border-mason-gray-100 bg-white p-8 shadow-sm">
              <div className="mb-6">
                <h2 className="font-kanit text-3xl font-black text-mason-black">Log In</h2>
                <p className="mt-2 text-sm leading-relaxed text-mason-gray-500">
                  Use the email and password you used when you ordered a review. We will take you to your latest report.
                </p>
              </div>

              <form onSubmit={handleLoginSubmit} className="space-y-4">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Email</label>
                  <input
                    required
                    type="email"
                    value={loginForm.email}
                    onChange={e => setLoginForm(prev => ({ ...prev, email: e.target.value }))}
                    className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                    placeholder="name@company.com"
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Password</label>
                  <input
                    required
                    type="password"
                    value={loginForm.password}
                    onChange={e => setLoginForm(prev => ({ ...prev, password: e.target.value }))}
                    className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                    placeholder="Enter your password"
                  />
                </div>

                {error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-mason-black py-4 text-base font-semibold text-white transition-colors hover:bg-mason-gray-800 disabled:opacity-60"
                >
                  {loginLoading ? 'Signing In...' : 'Open My Latest Report'}
                </button>
              </form>
            </div>
          ) : (
            <>
              {phase === 'upload' && (
                <div
                  className={`cursor-pointer rounded-3xl border-2 border-dashed p-12 text-center transition-all ${
                    dragOver
                      ? 'border-black bg-mason-gray-50'
                      : 'border-mason-gray-200 hover:border-mason-gray-400 hover:bg-mason-gray-50'
                  }`}
                  onDragOver={e => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="mb-4 text-xs font-semibold uppercase tracking-[0.3em] text-mason-gray-400">
                    Upload Contract Files
                  </div>
                  <p className="mb-2 font-kanit text-2xl font-bold text-mason-black">
                    Drop your contract documents here
                  </p>
                  <p className="mb-6 text-sm text-mason-gray-500">
                    PDF, Word, Excel, and image files accepted
                  </p>
                  <div className="inline-flex rounded-xl bg-mason-black px-6 py-3 text-sm font-semibold text-white">
                    Choose Files
                  </div>
                  <p className="mt-4 text-xs text-mason-gray-400">
                    Tip: split very large contracts into main contract and annexures for faster previews.
                  </p>
                </div>
              )}

              {(phase === 'form' || phase === 'processing') && (
                <div className="rounded-3xl border border-mason-gray-100 bg-white p-8 shadow-sm">
                  <div className="mb-6">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-semibold text-mason-black">
                        {files.length} file{files.length === 1 ? '' : 's'} selected
                      </span>
                      {phase === 'form' && (
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-sm text-mason-gray-500 underline"
                        >
                          Add more
                        </button>
                      )}
                    </div>

                    <div className="space-y-2">
                      {files.map(file => (
                        <div key={file.id} className="flex items-center gap-3 rounded-xl bg-mason-gray-50 px-4 py-3">
                          <span className="min-w-[44px] rounded-lg bg-white px-2 py-1 text-center text-xs font-semibold text-mason-gray-500">
                            {fileIcon(file.file.name)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-mason-black">{file.file.name}</p>
                            <div className="mt-1 flex items-center gap-2">
                              <span className="text-xs text-mason-gray-400">{formatBytes(file.file.size)}</span>
                              {file.status === 'uploading' && (
                                <>
                                  <div className="h-1 flex-1 rounded-full bg-mason-gray-200">
                                    <div
                                      className="h-1 rounded-full bg-mason-black"
                                      style={{ width: `${file.progress}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-mason-gray-400">{file.progress}%</span>
                                </>
                              )}
                            </div>
                          </div>
                          {phase === 'form' && (
                            <button
                              type="button"
                              onClick={() => removeFile(file.id)}
                              className="text-lg text-mason-gray-300 hover:text-mason-gray-600"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {phase === 'form' && (
                    <form onSubmit={handleSignupSubmit} className="space-y-5">
                      <div className="border-t border-mason-gray-100 pt-6">
                        <p className="mb-4 text-sm font-semibold text-mason-black">Your details</p>

                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">First name</label>
                            <input
                              required
                              type="text"
                              value={signupForm.firstName}
                              onChange={e => setSignupForm(prev => ({ ...prev, firstName: e.target.value }))}
                              className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                              placeholder="First name"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Last name</label>
                            <input
                              required
                              type="text"
                              value={signupForm.lastName}
                              onChange={e => setSignupForm(prev => ({ ...prev, lastName: e.target.value }))}
                              className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                              placeholder="Last name"
                            />
                          </div>
                        </div>

                        <div className="mt-4">
                          <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Email</label>
                          <input
                            required
                            type="email"
                            value={signupForm.email}
                            onChange={e => setSignupForm(prev => ({ ...prev, email: e.target.value }))}
                            className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                            placeholder="name@company.com"
                          />
                        </div>

                        <div className="mt-4">
                          <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Password</label>
                          <input
                            required
                            type="password"
                            minLength={8}
                            value={signupForm.password}
                            onChange={e => setSignupForm(prev => ({ ...prev, password: e.target.value }))}
                            className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                            placeholder="Create a password"
                          />
                        </div>

                        <div className="mt-4">
                          <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Company name</label>
                          <input
                            required
                            type="text"
                            value={signupForm.companyName}
                            onChange={e => setSignupForm(prev => ({ ...prev, companyName: e.target.value }))}
                            className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                            placeholder="Company name"
                          />
                        </div>

                        <div className="mt-4 grid grid-cols-2 gap-4">
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Phone <span className="text-mason-gray-300">(optional)</span></label>
                            <input
                              type="tel"
                              value={signupForm.phone}
                              onChange={e => setSignupForm(prev => ({ ...prev, phone: e.target.value }))}
                              className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                              placeholder="Phone number"
                            />
                          </div>
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-mason-gray-500">Website <span className="text-mason-gray-300">(optional)</span></label>
                            <input
                              type="url"
                              value={signupForm.website}
                              onChange={e => setSignupForm(prev => ({ ...prev, website: e.target.value }))}
                              className="w-full rounded-xl border border-mason-gray-200 px-4 py-3 text-sm text-mason-black"
                              placeholder="https://company.com"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="border-t border-mason-gray-100 pt-5">
                        <p className="mb-3 text-sm font-semibold text-mason-black">Which country&apos;s construction law should Mason use?</p>
                        <div className="grid gap-3">
                          {JURISDICTIONS.map(option => (
                            <label
                              key={option.value}
                              className={`cursor-pointer rounded-xl border-2 px-4 py-4 transition-all ${
                                signupForm.jurisdiction === option.value
                                  ? 'border-mason-black bg-mason-gray-50'
                                  : 'border-mason-gray-200 hover:border-mason-gray-300'
                              }`}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name="jurisdiction"
                                value={option.value}
                                checked={signupForm.jurisdiction === option.value}
                                onChange={() => setSignupForm(prev => ({ ...prev, jurisdiction: option.value }))}
                              />
                              <p className="text-sm font-semibold text-mason-black">{option.label}</p>
                              <p className="mt-1 text-xs text-mason-gray-400">{option.sublabel}</p>
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="border-t border-mason-gray-100 pt-5">
                        <p className="mb-3 text-sm font-semibold text-mason-black">Which type of contract is this?</p>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { value: 'subcontract', label: 'Subcontract', sub: 'You are the subcontractor' },
                            { value: 'head_contract', label: 'Head contract', sub: 'You are the main contractor' },
                          ].map(option => (
                            <label
                              key={option.value}
                              className={`cursor-pointer rounded-xl border-2 px-4 py-4 transition-all ${
                                signupForm.contractType === option.value
                                  ? 'border-mason-black bg-mason-gray-50'
                                  : 'border-mason-gray-200 hover:border-mason-gray-300'
                              }`}
                            >
                              <input
                                type="radio"
                                className="sr-only"
                                name="contractType"
                                value={option.value}
                                checked={signupForm.contractType === option.value}
                                onChange={() => setSignupForm(prev => ({ ...prev, contractType: option.value as ContractType }))}
                              />
                              <p className="text-sm font-semibold text-mason-black">{option.label}</p>
                              <p className="mt-1 text-xs text-mason-gray-400">{option.sub}</p>
                            </label>
                          ))}
                        </div>
                      </div>

                      {error && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                          {error}
                        </div>
                      )}

                      <button
                        type="submit"
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-mason-black py-4 text-base font-semibold text-white transition-colors hover:bg-mason-gray-800"
                      >
                        Generate Fast Preview
                        <span>→</span>
                      </button>
                    </form>
                  )}

                  {phase === 'processing' && (
                    <div className="py-8 text-center">
                      <div className="mb-6 inline-flex items-center gap-3">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-mason-black border-t-transparent" />
                        <span className="text-sm font-medium text-mason-black">{processingMsg}</span>
                      </div>
                      <p className="text-xs text-mason-gray-400">
                        Generating your fast preview now. You will be redirected to the report page immediately.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
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

      <section id="how" className="border-t border-mason-gray-100 bg-mason-gray-50 px-6 py-20">
        <div className="mx-auto max-w-4xl">
          <p className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.32em] text-mason-gray-400">
            How it works
          </p>
          <h2 className="mb-12 text-center font-kanit text-4xl font-black text-mason-black">
            Preview first. Full report when you need it.
          </h2>
          <div className="grid gap-8 md:grid-cols-3">
            {[
              {
                n: '01',
                title: 'Upload and choose jurisdiction',
                body: 'Choose Australia, United Kingdom, or United States so the review is grounded in the right legal framework.',
              },
              {
                n: '02',
                title: 'Get a fast preview',
                body: 'Mason returns the executive summary, risk counts, and the most important early warning first.',
              },
              {
                n: '03',
                title: 'Unlock the full report later',
                body: 'Returning customers can log back in and full analysis only runs when needed, which keeps the initial experience much faster.',
              },
            ].map(item => (
              <div key={item.n} className="rounded-2xl border border-mason-gray-100 bg-white p-6">
                <p className="mb-3 font-kanit text-4xl font-black text-mason-gray-100">{item.n}</p>
                <p className="mb-2 text-sm font-semibold text-mason-black">{item.title}</p>
                <p className="text-sm leading-relaxed text-mason-gray-500">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
