# SharePoint connector

Adapter for **Microsoft 365 SharePoint document libraries** via the
Microsoft Graph API.

This implementation is **mocked**. The mock returns the same response shapes
the real Graph endpoints return, so the rest of the platform can be written
against the same `Connector` contract regardless of whether it talks to the
real Graph or the fixture. Every mocked call carries a `REAL:` comment
pointing at the Graph endpoint a production call would hit — `grep "REAL:" .`
to audit.

## Auth mode

`oauth2-obo` — OAuth 2.0 On-Behalf-Of. The server (this adapter) exchanges
the user's Entra ID token from the Auth.js session for a Graph access token
scoped to that user. The user's own SharePoint permissions apply, which keeps
matter walls intact.

## Production app registration

1. Register an app in Entra ID (Azure portal → App registrations → New).
2. Add a redirect URI for the Auth.js callback
   (`https://<vercel-url>/api/auth/callback/microsoft-entra-id`).
3. Configure delegated API permissions on the app:
   - `Sites.Read.All`
   - `Files.ReadWrite.All`
   - `offline_access`
4. Grant admin consent for the tenant.
5. Populate `AUTH_MICROSOFT_ENTRA_ID` and `AUTH_MICROSOFT_ENTRA_SECRET` in
   the deployment env. The OBO exchange uses the same client credentials.

## Production token-exchange flow

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
  grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer
  client_id={app-client-id}
  client_secret={app-client-secret}
  assertion={user-id-token-from-Auth.js-session}
  scope=https://graph.microsoft.com/Sites.Read.All
        https://graph.microsoft.com/Files.ReadWrite.All
        offline_access
  requested_token_use=on_behalf_of
```

Cache the returned access token per-user with the standard TTL (typically
~1 hour) and renew via the refresh token grant when it nears expiry.

## Production data-plane endpoints

| Operation | Endpoint |
| --- | --- |
| List child folders | `GET /sites/{siteId}/drives/{driveId}/items/{parent}/children?$filter=folder ne null` |
| List child documents | `GET /sites/{siteId}/drives/{driveId}/items/{parent}/children?$filter=file ne null` |
| Fetch document content | `GET /sites/{siteId}/drives/{driveId}/items/{id}/content` |
| Upload document (small, <4MB) | `PUT /sites/{siteId}/drives/{driveId}/items/{parent}:/{name}:/content` |
| Upload document (large, ≥4MB) | `POST /sites/{siteId}/drives/{driveId}/items/{parent}:/{name}:/createUploadSession`, then `PUT` byte ranges |
| Search | `POST /search/query` with `entityTypes: ['driveItem']` and a SharePoint-scoped query |

All endpoints require `Authorization: Bearer {accessToken}`.

## Notes for a real deployment

- Pagination is via `@odata.nextLink` — model that in the adapter when
  switching from mock to real.
- For Office files, `?format=pdf` on the content endpoint returns a
  server-rendered PDF, which is what the review pipeline ultimately needs.
- Throttling: Graph returns `429` with a `Retry-After` header. The real
  adapter must respect it.
- `lastModifiedDateTime` is the only delta-detection signal exposed by the
  raw API; for change feeds use `delta` endpoints on the drive.
