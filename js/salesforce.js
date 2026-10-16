// Salesforce REST API helpers

const API_VERSION = 'v61.0';

async function sfFetch(path, accessToken, instanceUrl) {
  const res = await fetch(`${instanceUrl}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => [{}]);
    const msg = Array.isArray(err) ? err[0]?.message : err.error_description;
    throw new Error(msg || `Salesforce API error ${res.status}`);
  }
  return res.json();
}

export async function getCurrentUser(accessToken, instanceUrl) {
  return sfFetch('/services/oauth2/userinfo', accessToken, instanceUrl);
}

async function query(accessToken, instanceUrl, soql) {
  const params = new URLSearchParams({ q: soql.replace(/\s+/g, ' ').trim() });
  const data = await sfFetch(
    `/services/data/${API_VERSION}/query?${params}`,
    accessToken,
    instanceUrl,
  );
  return data.records || [];
}

export async function getMyAccounts(accessToken, instanceUrl, userId) {
  return query(accessToken, instanceUrl, `
    SELECT Id, Name, Type, Industry, Website, BillingCity
    FROM Account
    WHERE OwnerId = '${userId}'
    ORDER BY LastModifiedDate DESC
    LIMIT 200
  `);
}

export async function getMyOpportunities(accessToken, instanceUrl, userId) {
  return query(accessToken, instanceUrl, `
    SELECT Id, Name, StageName, AccountId, Account.Name, CloseDate, Amount
    FROM Opportunity
    WHERE OwnerId = '${userId}'
    AND IsClosed = false
    ORDER BY LastModifiedDate DESC
    LIMIT 200
  `);
}
