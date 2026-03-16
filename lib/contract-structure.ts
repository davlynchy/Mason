import type { ExtractionEvidence } from '@/lib/ai';

export interface ContractSection {
  filename: string;
  sectionType: 'document_intro' | 'clause' | 'schedule' | 'annexure' | 'page_block';
  sectionLabel: string | null;
  clauseNumber: string | null;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  sortOrder: number;
}

interface WorkingSection {
  sectionType: ContractSection['sectionType'];
  sectionLabel: string | null;
  clauseNumber: string | null;
  heading: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  lines: string[];
}

const CLAUSE_HEADING_RE = /^(\d+(?:\.\d+){0,3})\s+(.{3,200})$/;
const PAGE_RE = /^Page\s+(\d+)\s+of\s+\d+/i;
const ALT_PAGE_RE = /^--\s*(\d+)\s+of\s+\d+\s*--$/i;

export function buildContractSections(evidence: ExtractionEvidence[]): ContractSection[] {
  const sections: ContractSection[] = [];
  let sortOrder = 0;

  for (const file of evidence) {
    if (!file.extractedText?.trim()) {
      continue;
    }

    const built = segmentExtractedText(file.filename, file.extractedText).map(section => ({
      ...section,
      sortOrder: sortOrder++,
    }));

    sections.push(...built);
  }

  return sections;
}

function segmentExtractedText(filename: string, text: string): Omit<ContractSection, 'sortOrder'>[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const sections: Array<Omit<ContractSection, 'sortOrder'>> = [];
  let currentPage: number | null = null;
  let current: WorkingSection = createWorkingSection('document_intro', 'Document introduction', null, null, null);

  const flush = () => {
    const content = current.lines.join('\n').trim();
    if (!content) {
      return;
    }

    sections.push({
      filename,
      sectionType: current.sectionType,
      sectionLabel: current.sectionLabel,
      clauseNumber: current.clauseNumber,
      heading: current.heading,
      pageStart: current.pageStart,
      pageEnd: current.pageEnd ?? current.pageStart,
      content,
    });
  };

  for (const line of lines) {
    const pageMatch = line.match(PAGE_RE) ?? line.match(ALT_PAGE_RE);
    if (pageMatch) {
      currentPage = Number(pageMatch[1]);
      if (current.pageStart === null) {
        current.pageStart = currentPage;
      }
      current.pageEnd = currentPage;
      current.lines.push(line);
      continue;
    }

    const clauseMatch = line.match(CLAUSE_HEADING_RE);
    if (clauseMatch && looksLikeClauseHeading(line)) {
      flush();
      current = createWorkingSection(
        classifySectionType(clauseMatch[2]),
        line,
        clauseMatch[1],
        clauseMatch[2],
        currentPage
      );
      current.lines.push(line);
      continue;
    }

    if (isStandaloneHeading(line) && current.lines.length > 20) {
      flush();
      current = createWorkingSection(
        classifySectionType(line),
        line,
        null,
        line,
        currentPage
      );
      current.lines.push(line);
      continue;
    }

    if (current.pageStart === null) {
      current.pageStart = currentPage;
    }
    current.pageEnd = currentPage ?? current.pageEnd;
    current.lines.push(line);
  }

  flush();

  return sections.map((section, index) => {
    if (section.content.length <= 12000) {
      return section;
    }

    return {
      ...section,
      content: section.content.slice(0, 12000),
      sectionLabel: `${section.sectionLabel ?? section.heading ?? 'Section'} (trimmed ${index + 1})`,
    };
  });
}

function createWorkingSection(
  sectionType: WorkingSection['sectionType'],
  sectionLabel: string | null,
  clauseNumber: string | null,
  heading: string | null,
  pageStart: number | null
): WorkingSection {
  return {
    sectionType,
    sectionLabel,
    clauseNumber,
    heading,
    pageStart,
    pageEnd: pageStart,
    lines: [],
  };
}

function classifySectionType(label: string): ContractSection['sectionType'] {
  const lowered = label.toLowerCase();
  if (lowered.includes('schedule')) {
    return 'schedule';
  }
  if (lowered.includes('annexure') || lowered.includes('appendix')) {
    return 'annexure';
  }
  if (/^\d/.test(label)) {
    return 'clause';
  }
  return 'page_block';
}

function looksLikeClauseHeading(line: string): boolean {
  if (line.length > 220) {
    return false;
  }

  if (/[.:;]$/.test(line)) {
    return false;
  }

  return true;
}

function isStandaloneHeading(line: string): boolean {
  if (line.length < 4 || line.length > 120) {
    return false;
  }

  const alphaChars = line.replace(/[^A-Za-z]/g, '');
  if (alphaChars.length < 4) {
    return false;
  }

  return line === line.toUpperCase() || /^[A-Z][A-Za-z0-9 ,/&()-]+$/.test(line);
}
