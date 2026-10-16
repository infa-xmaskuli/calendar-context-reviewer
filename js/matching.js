// Suggest Salesforce Accounts / Opportunities for a Google Calendar event

const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with','by',
  'from','as','is','was','are','were','be','been','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','it','its','this',
  'that','these','those','i','we','you','he','she','they','call','meeting',
  'review','sync','chat','discuss','discussion','intro','follow','up','check',
  'catchup','kickoff','debrief','prep','planning','session','weekly','monthly',
]);

function tokenize(text) {
  if (!text) return new Set();
  return new Set(
    text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w)),
  );
}

function emailDomain(email) {
  if (!email) return null;
  const host = email.split('@')[1]?.toLowerCase();
  if (!host) return null;
  const generic = ['gmail.com','yahoo.com','hotmail.com','outlook.com','icloud.com','me.com'];
  return generic.includes(host) ? null : host;
}

function websiteDomain(website) {
  if (!website) return null;
  try {
    const url = website.startsWith('http') ? website : `https://${website}`;
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch { return null; }
}

function scoreRecord(eventTokens, descTokens, attendeeDomains, recordName, website) {
  const nameTokens = tokenize(recordName);
  let score = 0;

  for (const t of nameTokens) {
    if (eventTokens.has(t)) score += 10;
    if (descTokens.has(t))  score += 3;
  }

  const acctDomain = websiteDomain(website);
  if (acctDomain) {
    for (const d of attendeeDomains) {
      if (d === acctDomain || d.endsWith(`.${acctDomain}`) || acctDomain.endsWith(`.${d}`)) {
        score += 25;
      }
    }
  }

  // Attendee domain root word appears in record name
  for (const d of attendeeDomains) {
    const root = d.split('.')[0];
    if (root.length > 3 && recordName.toLowerCase().includes(root)) {
      score += 8;
    }
  }

  return score;
}

export function suggestMatches(event, accounts, opportunities, limit = 5) {
  const eventTokens = tokenize(event.summary);
  const descTokens  = tokenize(event.description);
  const attendeeDomains = (event.attendees || [])
    .map(a => emailDomain(a.email))
    .filter(Boolean);

  const scored = [];

  for (const acct of accounts) {
    const s = scoreRecord(eventTokens, descTokens, attendeeDomains, acct.Name, acct.Website);
    if (s > 0) scored.push({ type: 'account', id: acct.Id, name: acct.Name, score: s });
  }

  for (const opp of opportunities) {
    const s1 = scoreRecord(eventTokens, descTokens, attendeeDomains, opp.Name, null);
    const s2 = opp.Account?.Name
      ? scoreRecord(eventTokens, descTokens, attendeeDomains, opp.Account.Name, null) * 0.8
      : 0;
    const s = Math.max(s1, s2);
    if (s > 0) {
      scored.push({
        type:        'opportunity',
        id:          opp.Id,
        name:        opp.Name,
        accountName: opp.Account?.Name || null,
        score:       s,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
