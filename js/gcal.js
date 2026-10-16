// Google Calendar REST API helpers

const BASE = 'https://www.googleapis.com/calendar/v3';

async function apiFetch(path, accessToken, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `GCal API error ${res.status}`);
  }
  return res.json();
}

export async function getUpcomingEvents(accessToken, daysAhead = 7) {
  const now = new Date();
  const end = new Date(now.getTime() + daysAhead * 86_400_000);

  const params = new URLSearchParams({
    timeMin:      now.toISOString(),
    timeMax:      end.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '50',
    fields:       'items(id,summary,description,start,end,attendees,htmlLink,status)',
  });

  const data = await apiFetch(`/calendars/primary/events?${params}`, accessToken);
  // Exclude cancelled events
  return (data.items || []).filter(e => e.status !== 'cancelled');
}

export async function updateEventTitle(accessToken, eventId, newSummary) {
  return apiFetch(`/calendars/primary/events/${eventId}`, accessToken, {
    method: 'PATCH',
    body:   JSON.stringify({ summary: newSummary }),
  });
}

export function formatEventTime(event) {
  const raw = event.start.dateTime || event.start.date;
  const d   = new Date(raw);

  if (event.start.date) {
    // All-day event
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  return d.toLocaleString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    hour:    'numeric',
    minute:  '2-digit',
  });
}

// Strip an existing " | Attribution" suffix so we can replace it cleanly
export function getBaseTitle(summary) {
  const idx = summary ? summary.lastIndexOf(' | ') : -1;
  return idx >= 0 ? summary.substring(0, idx) : (summary || '');
}
