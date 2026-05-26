# iManage Work connector

Adapter for the **iManage Work** document management system used by ~81% of
AmLaw 200 firms. This implementation is **mocked**; the responses mirror
iManage Work REST API shapes so the rest of the platform writes against the
same `Connector` contract. Every mocked call has a `REAL:` comment naming
the exact endpoint a production call would hit.

## Auth mode

`oauth2-pkce` — OAuth 2.0 Authorization Code with PKCE. iManage Work
exposes a tenant-hosted authorisation server that chains to the firm's
identity provider (commonly Microsoft Entra or Okta via SAML); the
adapter only needs to drive the OAuth flow itself.

## Production app registration

iManage app registration is done by the firm's iManage administrator (not
self-service from the customer side). The platform vendor (us) provides:

1. Application name, intended scopes, redirect URIs, and a logo.
2. The PKCE flow's redirect URI — typically
   `https://<vercel-url>/api/integrations/imanage/callback`.
3. Requested OAuth scopes:
   - `admin` (read library + folder metadata, list customers)
   - `user` (act on behalf of the signed-in attorney)
   - optional: `downloads` for content endpoints.

The firm admin returns a client id (no secret — PKCE) and the tenant base
URL `https://{customer}.imanage.work`.

## Production auth flow

```
1. Browser → GET https://{customer}.imanage.work/auth/oauth2/authorize
     ?response_type=code
     &client_id={app-client-id}
     &redirect_uri={app-callback-url}
     &scope=admin user
     &code_challenge={S256(verifier)}
     &code_challenge_method=S256
     &state={csrf-token}

2. User authenticates (iManage chains to the firm's SSO).

3. Server exchanges code for tokens:
   POST https://{customer}.imanage.work/auth/oauth2/token
     grant_type=authorization_code
     code={auth-code}
     redirect_uri={app-callback-url}
     client_id={app-client-id}
     code_verifier={pkce-verifier}
```

Store `access_token` (typically 1h TTL) + `refresh_token` per workspace
member. Refresh via the standard OAuth refresh grant when needed.

## Production data-plane endpoints

Base: `https://{customer}.imanage.work/work/api/v2`. All require
`Authorization: Bearer {accessToken}`.

| Operation | Endpoint |
| --- | --- |
| List clients (top of tree) | `GET /customers/{customerId}/libraries/{library}/clients` |
| List child folders | `GET /customers/{customerId}/libraries/{library}/folders/{folderId}/children?type=folder` |
| List child documents | `GET /customers/{customerId}/libraries/{library}/folders/{folderId}/children?type=document` |
| Download document content | `GET /customers/{customerId}/libraries/{library}/documents/{docId}/download` |
| Upload document (create) | `POST /customers/{customerId}/libraries/{library}/documents` then `PUT .../{newId}/upload` |
| Search documents | `POST /customers/{customerId}/libraries/{library}/documents/search` |

Document ids are formatted `LIBRARY!NUMBER.VERSION` (e.g. `ACTIVE!387245.1`).
Passing only `LIBRARY!NUMBER` resolves to the latest version.

## Notes for a real deployment

- Library name (`ACTIVE`, `RETIRED`, etc.) is firm-specific. Surface it on
  the connector setup screen.
- Profile fields (custom1, custom2, ...) carry firm-specific metadata
  like matter number, client number, document type. Capture them on
  upload to keep iManage-native search working.
- Some firms run on-prem ("Work Server" deployments) at a custom hostname
  with the same API surface. The adapter doesn't care, as long as
  `baseUrl` is configured per workspace.
- iManage versioning is automatic — every upload creates a new version
  rather than overwriting. Use the `versions` endpoint when you need
  to surface revision history in MatterPilot.
