import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import App from '../src/App';
import { ReviewNavigation, WorkflowBar } from '../src/ReviewShell';
import { Modules, Ready } from './fixtures';

it('brands the public page Endo without changing internal identifiers', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? Modules : Ready), { headers: { 'X-Clinical-Mode': 'standard' } })));
  render(<App />); await screen.findByRole('option', { name: 'Fictional review module' });
  expect(document.title).toBe('Endo | Clinical Evidence Assistant');
  expect(screen.getByRole('link', { name: 'Endo — case details' })).toHaveAttribute('href', '#caseForm');
  expect(document.querySelector('footer strong')).toHaveTextContent('Endo');
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('New evidence review');
  const html = readFileSync('index.html', 'utf8');
  expect(html).toContain('<title>Endo | Clinical Evidence Assistant</title>'); expect(html).not.toContain('Clarity Clinical Support');
  expect(screen.getByLabelText(/Clinical module/)).toHaveValue(''); expect(screen.getByRole('button', { name: 'Analyze' })).toBeDisabled();
});
it('exposes only real section navigation and no saved-case or account controls', () => {
  render(<ReviewNavigation />);
  const navigation = screen.getByRole('navigation', { name: 'Review sections' });
  expect(Array.from(navigation.querySelectorAll('a')).map(link => link.getAttribute('href'))).toEqual(['#caseForm', '#uploadTitle', '#evidenceWorkspace', '#scopeTitle']);
  expect(navigation).not.toHaveTextContent(/saved|profile|login|notification/i);
});
it('announces the actual workflow stage without simulated completion', () => {
  const view = render(<WorkflowBar pending={false} hasResponse={false} />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Case details');
  view.rerender(<WorkflowBar pending hasResponse={false} />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Analyze');
  view.rerender(<WorkflowBar pending={false} hasResponse />); expect(document.querySelector('[aria-current=step]')).toHaveTextContent('Evidence review');
});
it('keeps case entry and its privacy indicator without a companion or routine safety panel', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/v1/modules') ? Modules : Ready))));
  render(<App />); await screen.findByRole('option', { name: 'Fictional review module' });
  expect(screen.queryByText(/review companion|evidence, with context|safety comes first/i)).not.toBeInTheDocument();
  expect(document.querySelector('.evidenceRail')).toBeNull();
  expect(screen.getByText('In-memory only')).toBeVisible();
  expect(screen.getByLabelText(/Clinical module/)).toBeVisible();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
