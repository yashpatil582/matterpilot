# NetDocuments connector

Adapter for **NetDocuments** cabinets via the public REST API. This
implementation is **mocked**; responses mirror NetDocs API shapes so the
rest of the platform writes against the same `Connector` contract. Every
mocked call has a `REAL:` comment naming the production endpoint.

## Auth mode

`saml-then-oauth` — NetDocs' "ndAuth" flow. The browser hits NetDocs'
ndAuth endpoint, which proxies a SAML AuthnRequest to the firm's IdP
(Entra, Okta, Ping, ...). The IdP returns a SAML assertion to NetDocs,
which exchanges it for an OAuth authorization code on the app callback.

## Production app registration

1. NetDocs admin registers the app via the NetDocs Developer Portal.
2. Configure redirect URI:
   `https://<vercel-url>/api/integrations/netdocs/callback`
3. Set scopes (NetDocs uses a coarse permission model — typically
   one scope per cabinet access tier).
4. The firm administrator returns:
   - `client_id` + `client_secret`
   - Region (`us`, `eu`, `au`)
   - Cabinet GUIDs the integration is permitted to read/write.

## Production auth flow

```
1. Browser → GET https://vault.netvoyage.com/neWeb2/ndAuth.aspx
     ?Issuer={app-saml-issuer}
     &RelayState={state-token}

2. NetDocs proxies the SAML AuthnRequest to the firm's IdP, then
   redirects back to the app callback with ?code=...&state=...

3. Server exchanges the code for tokens:
   POST https://api.{region}.netdocuments.com/v1/OAuth
     grant_type=authorization_code
     code={auth-code}
     redirect_uri={app-callback-url}
     client_id={app-client-id}
     client_secret={app-client-secret}
```

Returned `access_token` is typically a 1-hour Bearer; `refresh_token` is
used via the standard OAuth refresh grant.

## Production data-plane endpoints

Base: `https://api.{region}.netdocuments.com/v1`. All require
`Authorization: Bearer {accessToken}`.

| Operation | Endpoint |
| --- | --- |
| Search workspaces | `GET /Search/{cabinetId}?q=workspace&fields=name,id,modificationDate` |
| List folder contents | `GET /Folder/{folderId}/contents?include=folders,documents` |
| Fetch document content | `GET /Document/{docId}?download=true` |
| Fetch as PDF render | `GET /Document/{docId}?renderType=pdf` |
| Upload document | `POST /Document` (multipart: `profile` JSON + `content` body) |
| Update profile fields | `PATCH /Document/{docId}` |

## Notes for a real deployment

- Cabinet GUIDs and region matter — wrong region = `404` even with a
  valid token. Capture region on the connector setup screen and store
  it on the workspace connector config row.
- Workspaces are NetDocs' equivalent of matters. Many firms map one
  client+matter pair to one workspace; surface that mapping at
  connector setup so MatterPilot matters tie to NetDocs workspaces.
- Profile fields (`profile.custom1..N`) carry firm-specific taxonomy.
  Capture them on upload to keep NetDocs-native search working.
- NetDocs has rate limits but does not document them publicly. The
  real adapter should honour `Retry-After` on `429` responses and
  back off exponentially.
- For long-running large uploads, the API supports chunked uploads via
  the `Document/{id}/Content` endpoint with byte-range PUTs.
