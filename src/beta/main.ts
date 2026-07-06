import './beta.css';
import { supabase } from '../lib/supabase';

/**
 * Beta landing page (beta.html) — public signup form writing to beta_signups.
 * RLS allows anonymous INSERT of pending rows only; nothing is readable here.
 * Approval happens in the app's Workspace panel (Founding Workspace admins).
 */

const form = document.getElementById('beta-form') as HTMLFormElement | null;
const msg = document.getElementById('beta-msg') as HTMLParagraphElement | null;
const submitBtn = document.getElementById('beta-submit') as HTMLButtonElement | null;

const show = (text: string, kind: 'ok' | 'err') => {
  if (!msg) return;
  msg.textContent = text;
  msg.className = `form-msg form-msg--${kind}`;
};

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!form || !submitBtn) return;

  const data = new FormData(form);
  const email = String(data.get('email') || '').trim().toLowerCase();
  const orgName = String(data.get('org_name') || '').trim();
  const contactName = String(data.get('contact_name') || '').trim();

  if (!orgName || !contactName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    show('Please fill in your shop name, your name, and a valid email.', 'err');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Sending…';

  const { error } = await supabase.from('beta_signups').insert({
    org_name: orgName,
    contact_name: contactName,
    email,
    store_url: String(data.get('store_url') || '').trim() || null,
    volume: String(data.get('volume') || '').trim() || null,
    notes: String(data.get('notes') || '').trim() || null,
  });

  if (!error) {
    form.reset();
    show("You're on the list! We review every request and will email you when your workspace is approved.", 'ok');
    submitBtn.textContent = 'Requested ✓';
    return;
  }

  submitBtn.disabled = false;
  submitBtn.textContent = 'Request access';
  if (error.code === '23505') {
    // unique lower(email) violation — they already signed up
    show("You're already on the list — we'll be in touch at that email.", 'ok');
  } else {
    show(`Something went wrong (${error.message}). Please try again or email us.`, 'err');
  }
});
