// Payper Trails — daily reminder worker
// Runs on a Cloudflare Cron Trigger (configured in wrangler.toml).
// Checks Supabase for licences, services, and warranties due in 30/14/7/0 days,
// and emails the owner once per threshold via Resend.

const THRESHOLDS = [30, 14, 7, 0];

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr); target.setUTCHours(0, 0, 0, 0);
  return Math.round((target - today) / (1000 * 60 * 60 * 24));
}

async function supabaseGet(env, path) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!res.ok) {
    console.log('Supabase GET failed', path, res.status, await res.text());
    return [];
  }
  return res.json();
}

async function supabasePost(env, path, body) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  });
}

async function alreadySent(env, itemType, itemId, threshold) {
  const rows = await supabaseGet(
    env,
    `reminder_log?item_type=eq.${itemType}&item_id=eq.${itemId}&threshold_days=eq.${threshold}&select=id`
  );
  return rows.length > 0;
}

async function logSent(env, itemType, itemId, threshold) {
  await supabasePost(env, 'reminder_log', {
    item_type: itemType,
    item_id: itemId,
    threshold_days: threshold,
  });
}

async function sendEmail(env, toEmail, subject, message) {
  if (!env.RESEND_API_KEY) {
    console.log('No RESEND_API_KEY set — skipping send to', toEmail, subject);
    return;
  }
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.REMINDER_FROM_EMAIL || 'Payper Trails <onboarding@resend.dev>',
      to: toEmail,
      subject,
      html: `<div style="font-family:sans-serif;font-size:15px;color:#1c1c1a;"><p>${message}</p>
        <p style="margin-top:24px;color:#888;font-size:13px;">— Payper Trails</p></div>`,
    }),
  });
}

async function runReminders(env) {
  // Build a lookup of user id -> email from profiles
  const profiles = await supabaseGet(env, 'profiles?select=id,email');
  const emailByUserId = Object.fromEntries(profiles.map(p => [p.id, p.email]));

  // Vehicles + their warranties in one call (warranties embeds via FK)
  const vehicles = await supabaseGet(env, 'vehicles?select=*,warranties(*)');

  for (const v of vehicles) {
    const email = emailByUserId[v.user_id];
    if (!email) continue;

    const licDays = daysUntil(v.licence_expiry);
    if (licDays !== null) {
      for (const t of THRESHOLDS) {
        if (licDays === t && !(await alreadySent(env, 'licence', v.id, t))) {
          const msg = t === 0
            ? `Your licence for <b>${v.name}</b> expires today (${v.licence_expiry}).`
            : `Your licence for <b>${v.name}</b> is due for renewal in ${t} days (${v.licence_expiry}).`;
          await sendEmail(env, email, `Licence renewal reminder — ${v.name}`, msg);
          await logSent(env, 'licence', v.id, t);
        }
      }
    }

    const svcDays = daysUntil(v.service_due_date);
    if (svcDays !== null) {
      for (const t of THRESHOLDS) {
        if (svcDays === t && !(await alreadySent(env, 'service', v.id, t))) {
          const msg = t === 0
            ? `<b>${v.name}</b> is due for a service today (${v.service_due_date}).`
            : `<b>${v.name}</b> is due for a service in ${t} days (${v.service_due_date}).`;
          await sendEmail(env, email, `Service reminder — ${v.name}`, msg);
          await logSent(env, 'service', v.id, t);
        }
      }
    }

    for (const w of v.warranties || []) {
      const wDays = daysUntil(w.expiry_date);
      if (wDays === null) continue;
      for (const t of THRESHOLDS) {
        if (wDays === t && !(await alreadySent(env, 'warranty', w.id, t))) {
          const msg = t === 0
            ? `Your <b>${w.item_name}</b> warranty on <b>${v.name}</b> expires today (${w.expiry_date}).`
            : `Your <b>${w.item_name}</b> warranty on <b>${v.name}</b> expires in ${t} days (${w.expiry_date}).`;
          await sendEmail(env, email, `Warranty expiring — ${w.item_name}`, msg);
          await logSent(env, 'warranty', w.id, t);
        }
      }
    }
  }
}

export default {
  // Cron-triggered entry point
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  },
  // Manual test entry point: visit the worker's URL + /run to trigger it by hand
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/run') {
      await runReminders(env);
      return new Response('Reminders checked.');
    }
    return new Response('Payper Trails reminder worker. Visit /run to test manually.');
  },
};
